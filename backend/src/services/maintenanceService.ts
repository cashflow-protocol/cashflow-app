import {
  TransactionModel,
  TransactionAction,
  TransactionStatus,
  UserCostBasisModel,
  UserModel,
} from '../models';
import { VaultPaymentModel } from '../models/VaultPayment';

export interface BackfillUserVaultReport {
  dryRun: boolean;
  scanned: number;
  mapped: number;
  unmapped: number;
  unmappedSample: Array<{ address: string; count: number }>;
  mappingSourceCount: number;
}

/**
 * Backfill `Transaction.userVaultAddress` for deposit/withdraw rows missing it.
 *
 * Builds a single `address → vaultAddress` lookup from every available source
 * (VaultPayment.cloudKey, deviceKey, walletAddress, multisigAddress + User.publicKey)
 * and matches each Transaction by its `walletAddress`. Transactions whose
 * walletAddress can't be mapped are tallied and reported.
 *
 * Limited to deposit + withdraw because those are the actions that drive cost
 * basis and reward verification.
 */
export async function backfillUserVaultAddress(
  opts: { dryRun: boolean },
): Promise<BackfillUserVaultReport> {
  const addressToVault = new Map<string, string>();

  const payments = await VaultPaymentModel.find(
    { vaultAddress: { $exists: true, $ne: null } },
    { cloudKey: 1, deviceKey: 1, walletAddress: 1, multisigAddress: 1, vaultAddress: 1 },
  ).lean();
  for (const p of payments) {
    if (!p.vaultAddress) continue;
    if (p.cloudKey) addressToVault.set(p.cloudKey, p.vaultAddress);
    if (p.deviceKey) addressToVault.set(p.deviceKey, p.vaultAddress);
    if (p.walletAddress) addressToVault.set(p.walletAddress, p.vaultAddress);
    if (p.multisigAddress) addressToVault.set(p.multisigAddress, p.vaultAddress);
  }

  const users = await UserModel.find({}, { publicKey: 1, vaultAddress: 1 }).lean();
  for (const u of users) {
    if (u.publicKey && u.vaultAddress && !addressToVault.has(u.publicKey)) {
      addressToVault.set(u.publicKey, u.vaultAddress);
    }
  }

  const missing = await TransactionModel.find(
    {
      $or: [{ userVaultAddress: { $exists: false } }, { userVaultAddress: null }],
      action: { $in: [TransactionAction.DEPOSIT, TransactionAction.WITHDRAW] },
    },
    { _id: 1, walletAddress: 1 },
  ).lean();

  let mapped = 0;
  let unmappedTotal = 0;
  const unmappedCounts = new Map<string, number>();
  const ops: Parameters<typeof TransactionModel.bulkWrite>[0] = [];

  for (const tx of missing) {
    const vault = addressToVault.get(tx.walletAddress);
    if (!vault) {
      unmappedTotal++;
      unmappedCounts.set(tx.walletAddress, (unmappedCounts.get(tx.walletAddress) ?? 0) + 1);
      continue;
    }
    mapped++;
    if (!opts.dryRun) {
      ops.push({
        updateOne: {
          filter: { _id: tx._id },
          update: { $set: { userVaultAddress: vault } },
        },
      });
    }
  }

  if (!opts.dryRun && ops.length > 0) {
    // Chunk to keep individual bulkWrite payloads small.
    const CHUNK = 1000;
    for (let i = 0; i < ops.length; i += CHUNK) {
      await TransactionModel.bulkWrite(ops.slice(i, i + CHUNK));
    }
  }

  const unmappedSample = [...unmappedCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([address, count]) => ({ address, count }));

  return {
    dryRun: opts.dryRun,
    scanned: missing.length,
    mapped,
    unmapped: unmappedTotal,
    unmappedSample,
    mappingSourceCount: addressToVault.size,
  };
}

export interface RebuildCostBasisReport {
  dryRun: boolean;
  aggregatedKeys: number;
  wouldCreate: number;
  wouldUpdate: number;
  unchanged: number;
  totalDepositsScanned: number;
  totalWithdrawalsScanned: number;
  ignoredMissingVault: number;
}

/**
 * Rebuild UserCostBasis from confirmed deposit/withdraw transactions.
 *
 * Aggregates totals by (userVaultAddress, mint) directly from Transaction rows
 * and overwrites UserCostBasis with the recomputed values. Idempotent: running
 * twice produces the same result. Run during low-traffic windows because an
 * in-flight CONFIRMED tx between aggregation and write could be missed (the
 * next casIncrementCostBasis would then double-count or skip it).
 *
 * Transactions still missing `userVaultAddress` after the backfill are
 * counted under `ignoredMissingVault` and excluded from totals.
 */
export async function rebuildUserCostBasis(
  opts: { dryRun: boolean },
): Promise<RebuildCostBasisReport> {
  let totalDeposits = 0;
  let totalWithdrawals = 0;
  let ignoredMissingVault = 0;

  type Bucket = {
    vaultAddress: string;
    mint: string;
    totalDeposited: bigint;
    totalWithdrawn: bigint;
    totalFeesCollected: bigint;
  };
  const totals = new Map<string, Bucket>();

  const cursor = TransactionModel.find(
    {
      status: TransactionStatus.CONFIRMED,
      action: { $in: [TransactionAction.DEPOSIT, TransactionAction.WITHDRAW] },
    },
    { userVaultAddress: 1, mint: 1, action: 1, amount: 1, feeAmount: 1 },
  )
    .lean()
    .cursor();

  for await (const tx of cursor) {
    if (!tx.userVaultAddress) {
      ignoredMissingVault++;
      continue;
    }
    if (tx.action === TransactionAction.DEPOSIT) totalDeposits++;
    else totalWithdrawals++;

    const key = `${tx.userVaultAddress}::${tx.mint}`;
    let bucket = totals.get(key);
    if (!bucket) {
      bucket = {
        vaultAddress: tx.userVaultAddress,
        mint: tx.mint,
        totalDeposited: 0n,
        totalWithdrawn: 0n,
        totalFeesCollected: 0n,
      };
      totals.set(key, bucket);
    }

    const amt = BigInt(tx.amount);
    if (tx.action === TransactionAction.DEPOSIT) {
      bucket.totalDeposited += amt;
    } else {
      bucket.totalWithdrawn += amt;
      if (tx.feeAmount) bucket.totalFeesCollected += BigInt(tx.feeAmount);
    }
  }

  let wouldCreate = 0;
  let wouldUpdate = 0;
  let unchanged = 0;

  for (const bucket of totals.values()) {
    const newDoc = {
      totalDeposited: bucket.totalDeposited.toString(),
      totalWithdrawn: bucket.totalWithdrawn.toString(),
      totalFeesCollected: bucket.totalFeesCollected.toString(),
    };

    const existing = await UserCostBasisModel.findOne(
      { vaultAddress: bucket.vaultAddress, mint: bucket.mint },
      { totalDeposited: 1, totalWithdrawn: 1, totalFeesCollected: 1 },
    ).lean();

    if (!existing) {
      wouldCreate++;
    } else if (
      existing.totalDeposited === newDoc.totalDeposited &&
      existing.totalWithdrawn === newDoc.totalWithdrawn &&
      existing.totalFeesCollected === newDoc.totalFeesCollected
    ) {
      unchanged++;
      continue;
    } else {
      wouldUpdate++;
    }

    if (!opts.dryRun) {
      await UserCostBasisModel.updateOne(
        { vaultAddress: bucket.vaultAddress, mint: bucket.mint },
        { $set: newDoc },
        { upsert: true },
      );
    }
  }

  return {
    dryRun: opts.dryRun,
    aggregatedKeys: totals.size,
    wouldCreate,
    wouldUpdate,
    unchanged,
    totalDepositsScanned: totalDeposits,
    totalWithdrawalsScanned: totalWithdrawals,
    ignoredMissingVault,
  };
}
