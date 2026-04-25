import { UserCostBasisModel, FeeTransactionModel, FeeTransactionStatus, FeeType, TransactionModel, TransactionAction, UserRewardProgressModel, RewardProgressStatus } from '../models';
import { TransferManager } from '../managers/TransferManager';
import { SUPPORTED_TOKENS_BY_MINT } from '../constants';
import type { SerializedInstruction } from '../types';

const FEE_RATE_NUMERATOR = 5n;
const FEE_RATE_DENOMINATOR = 100n;

const TREASURY_WALLET_ADDRESS = process.env.TREASURY_WALLET_ADDRESS;

const transferManager = new TransferManager();

export interface FeeCalculation {
  feeAmount: bigint;
  profitAmount: bigint;
}

/**
 * Calculate the 5% profit fee for a withdrawal.
 * Uses running cost basis: profit = cumulative_withdrawn - cumulative_deposited.
 * Only charges fee on the marginal profit of this specific withdrawal.
 */
export async function calculateFee(
  vaultAddress: string,
  mint: string,
  withdrawAmount: string,
): Promise<FeeCalculation> {
  const costBasis = await UserCostBasisModel.findOne({ vaultAddress, mint }).lean();

  const totalDeposited = BigInt(costBasis?.totalDeposited ?? '0');
  const totalWithdrawn = BigInt(costBasis?.totalWithdrawn ?? '0');
  const withdrawAmountBig = BigInt(withdrawAmount);

  const newTotalWithdrawn = totalWithdrawn + withdrawAmountBig;

  // Total cumulative profit after this withdrawal
  const totalProfit = newTotalWithdrawn > totalDeposited ? newTotalWithdrawn - totalDeposited : 0n;

  // Cumulative profit before this withdrawal
  const previousProfit = totalWithdrawn > totalDeposited ? totalWithdrawn - totalDeposited : 0n;

  // Marginal profit attributable to this withdrawal
  const marginalProfit = totalProfit - previousProfit;

  // 5% fee, integer division rounds down (favors user)
  const feeAmount = (marginalProfit * FEE_RATE_NUMERATOR) / FEE_RATE_DENOMINATOR;

  return { feeAmount, profitAmount: marginalProfit };
}

/**
 * Build transfer instructions to send the fee from user wallet to treasury.
 * Reuses TransferManager which handles SOL, SPL, and Token-2022.
 */
export async function buildFeeTransferInstructions(
  mint: string,
  feeAmount: string,
  ownerAddress: string,
): Promise<SerializedInstruction[]> {
  if (!TREASURY_WALLET_ADDRESS) {
    throw new Error('TREASURY_WALLET_ADDRESS not configured');
  }

  const tokenInfo = SUPPORTED_TOKENS_BY_MINT[mint];
  const decimals = tokenInfo?.decimals ?? 6;

  return transferManager.getTransferInstructions(
    mint,
    feeAmount,
    ownerAddress,
    TREASURY_WALLET_ADDRESS,
    decimals,
  );
}

/**
 * Create a FeeTransaction audit record.
 */
export async function createFeeRecord(params: {
  vaultAddress: string;
  mint: string;
  withdrawTransactionId: string;
  withdrawAmount: string;
  profitAmount: string;
  feeAmount: string;
}): Promise<void> {
  await FeeTransactionModel.create({
    ...params,
    feeType: FeeType.PROFIT,
    status: FeeTransactionStatus.PENDING,
  });
}

/**
 * Record a vault creation fee payment.
 */
export async function createVaultCreationFeeRecord(params: {
  vaultAddress: string;
  feeAmount: string;
  signature: string;
}): Promise<void> {
  await FeeTransactionModel.create({
    vaultAddress: params.vaultAddress,
    mint: 'So11111111111111111111111111111111111111112', // native SOL
    feeType: FeeType.VAULT_CREATION,
    feeAmount: params.feeAmount,
    signature: params.signature,
    status: FeeTransactionStatus.CONFIRMED,
  });
}

/**
 * Atomically increment a string-typed BigInt counter on a UserCostBasis doc
 * using compare-and-swap. The field stays a string (BigInt-safe), so MongoDB's
 * native $inc isn't usable — we retry on lost updates instead.
 */
async function casIncrementCostBasis(
  vaultAddress: string,
  mint: string,
  increments: Partial<Record<'totalDeposited' | 'totalWithdrawn' | 'totalFeesCollected', bigint>>,
): Promise<void> {
  const fields = Object.keys(increments) as Array<keyof typeof increments>;

  for (let attempt = 0; attempt < 10; attempt++) {
    const doc = await UserCostBasisModel.findOneAndUpdate(
      { vaultAddress, mint },
      { $setOnInsert: { totalDeposited: '0', totalWithdrawn: '0', totalFeesCollected: '0' } },
      { upsert: true, new: true },
    ).lean();

    const filter: Record<string, unknown> = { vaultAddress, mint };
    const setFields: Record<string, string> = {};
    for (const field of fields) {
      const currentStr = (doc as unknown as Record<string, string>)[field] ?? '0';
      filter[field] = currentStr;
      setFields[field] = (BigInt(currentStr) + (increments[field] ?? 0n)).toString();
    }

    const result = await UserCostBasisModel.updateOne(filter, { $set: setFields });
    if (result.matchedCount === 1) return;
  }

  throw new Error(`casIncrementCostBasis: exceeded retries for ${vaultAddress}/${mint}`);
}

/**
 * Run all post-confirm side effects for a transaction: cost basis updates and
 * reward verifier cache invalidation. Called from both the scheduler poll and
 * the Helius webhook path so behavior stays in sync.
 */
export async function onTransactionConfirmed(transactionId: string): Promise<void> {
  const tx = await TransactionModel.findById(transactionId).lean();
  if (!tx) return;

  const { vaultAddress, mint, amount, action, feeAmount } = tx;

  if (!vaultAddress) return;

  if (action === TransactionAction.DEPOSIT) {
    await casIncrementCostBasis(vaultAddress, mint, { totalDeposited: BigInt(amount) });
  } else if (action === TransactionAction.WITHDRAW) {
    const increments: Parameters<typeof casIncrementCostBasis>[2] = {
      totalWithdrawn: BigInt(amount),
    };
    if (feeAmount) {
      increments.totalFeesCollected = BigInt(feeAmount);
    }
    await casIncrementCostBasis(vaultAddress, mint, increments);

    // Update the associated FeeTransaction status
    await FeeTransactionModel.findOneAndUpdate(
      { withdrawTransactionId: transactionId, status: FeeTransactionStatus.PENDING },
      { $set: { status: FeeTransactionStatus.CONFIRMED } },
    );
  }

  // Invalidate reward verifier TTL cache so the next read re-evaluates
  // progress against the freshly-confirmed transaction.
  await UserRewardProgressModel.updateMany(
    { vaultAddress, status: RewardProgressStatus.IN_PROGRESS },
    { $unset: { lastEvaluatedAt: '' } },
  ).catch((err) => console.error('[onTransactionConfirmed] reward cache invalidation error:', err));
}

/** @deprecated use onTransactionConfirmed */
export const updateCostBasisOnConfirm = onTransactionConfirmed;

/**
 * Mark fee transaction as failed when the withdrawal transaction fails.
 */
export async function markFeeTransactionFailed(transactionId: string): Promise<void> {
  await FeeTransactionModel.findOneAndUpdate(
    { withdrawTransactionId: transactionId, status: FeeTransactionStatus.PENDING },
    { $set: { status: FeeTransactionStatus.FAILED } },
  );
}
