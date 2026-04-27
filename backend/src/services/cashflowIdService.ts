import { createSolanaRpc } from '@solana/kit';
import type { Rpc, SolanaRpcApi, Signature } from '@solana/kit';
import {
  CashflowIdActivationModel,
  CashflowIdActivationStatus,
  UserModel,
} from '../models';
import { RewardMintBuilder, getCashflowIdActivationFeeLamports } from '../managers/RewardMintBuilder';
import { enqueueClaimableAttributes } from './badgeAttributeService';

const builder = new RewardMintBuilder();

const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const rpc: Rpc<SolanaRpcApi> = createSolanaRpc(rpcUrl);

export type ConfirmOutcome = 'confirmed' | 'failed' | 'pending';

export interface ActivationBuildResult {
  activationId: string;
  assetAddress: string;
  collectionAddress: string;
  innerInstructions: Awaited<ReturnType<RewardMintBuilder['buildCashflowIdMintTransaction']>>['innerInstructions'];
  mintTransactionBase64: string;
  blockhash: string;
  mintFeeLamports: string;
}

/**
 * Build a Cashflow ID activation transaction for a vault. Persists a PENDING
 * activation row and returns the data the mobile needs to bundle in the
 * vault's Squads execute.
 *
 * If the user already has a Cashflow ID, throws — caller should branch on the
 * `User.cashflowIdAddress` field before calling this.
 *
 * If a PENDING activation already exists, fail it (the previous attempt likely
 * never landed) and create a new one. Recovery cron can reconcile by checking
 * signatures on-chain.
 */
export async function buildActivation(vaultAddress: string): Promise<ActivationBuildResult> {
  const user = await UserModel.findOne({ vaultAddress }, { cashflowIdAddress: 1 }).lean();
  if (user?.cashflowIdAddress) {
    throw new Error('Cashflow ID already activated');
  }

  // Drop any old PENDING activation for this vault — retrying replaces it.
  await CashflowIdActivationModel.updateMany(
    { vaultAddress, status: CashflowIdActivationStatus.PENDING },
    { $set: { status: CashflowIdActivationStatus.FAILED } },
  );

  const built = await builder.buildCashflowIdMintTransaction({ vaultAddress });
  const feeLamports = getCashflowIdActivationFeeLamports().toString();

  const activation = await CashflowIdActivationModel.create({
    vaultAddress,
    assetAddress: built.assetAddress,
    collectionAddress: built.collectionAddress,
    status: CashflowIdActivationStatus.PENDING,
    bundleSignatures: [],
    feeAmount: feeLamports,
  });

  return {
    activationId: String(activation._id),
    assetAddress: built.assetAddress,
    collectionAddress: built.collectionAddress,
    innerInstructions: built.innerInstructions,
    mintTransactionBase64: built.mintTransactionBase64,
    blockhash: built.blockhash,
    mintFeeLamports: feeLamports,
  };
}

/**
 * Record bundle signatures from the mobile and try to verify on-chain
 * synchronously. On confirm, writes User.cashflowIdAddress and triggers
 * the auto-add for any already-claimable badges.
 */
export async function recordAndConfirmActivation(
  activationId: string,
  vaultAddress: string,
  bundleSignatures: string[],
): Promise<ConfirmOutcome> {
  const activation = await CashflowIdActivationModel.findOne({ _id: activationId, vaultAddress });
  if (!activation) throw new Error('Activation not found');

  activation.bundleSignatures = bundleSignatures;
  if (activation.status === CashflowIdActivationStatus.PENDING) {
    await activation.save();
  }

  return tryConfirmActivation(activation);
}

/**
 * Check signatures on-chain. Promote PENDING → CONFIRMED + write User
 * fields + enqueue badge auto-adds. Or PENDING → FAILED. Returns 'pending'
 * if signatures haven't landed yet.
 */
export async function tryConfirmActivation(activation: any): Promise<ConfirmOutcome> {
  if (activation.status === CashflowIdActivationStatus.CONFIRMED) return 'confirmed';
  if (activation.status === CashflowIdActivationStatus.FAILED) return 'failed';

  const sigs = activation.bundleSignatures.filter((s: string | undefined): s is string => !!s);
  if (sigs.length === 0) return 'pending';

  const statuses = await rpc
    .getSignatureStatuses(sigs as Signature[], { searchTransactionHistory: true })
    .send();

  let anyFailed = false;
  let allConfirmed = true;
  let allUnknown = true;
  for (const status of statuses.value) {
    if (!status) continue;
    allUnknown = false;
    if (status.err) anyFailed = true;
    if (status.confirmationStatus !== 'confirmed' && status.confirmationStatus !== 'finalized') {
      allConfirmed = false;
    }
  }

  if (anyFailed) {
    activation.status = CashflowIdActivationStatus.FAILED;
    await activation.save();
    return 'failed';
  }
  if (!allUnknown && allConfirmed) {
    activation.status = CashflowIdActivationStatus.CONFIRMED;
    await activation.save();

    await UserModel.updateOne(
      { vaultAddress: activation.vaultAddress },
      { $set: { cashflowIdAddress: activation.assetAddress, cashflowIdActivatedAt: new Date() } },
    );

    // Pick up any badges already in CLAIMABLE state.
    enqueueClaimableAttributes(activation.vaultAddress).catch((err) =>
      console.error('[activation] enqueueClaimableAttributes error:', err),
    );

    return 'confirmed';
  }
  return 'pending';
}

export async function failActivation(activation: any): Promise<void> {
  activation.status = CashflowIdActivationStatus.FAILED;
  await activation.save();
}
