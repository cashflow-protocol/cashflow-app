import { createSolanaRpc, address } from '@solana/kit';
import type { Rpc, SolanaRpcApi, Signature } from '@solana/kit';
import {
  CashflowPassportActivationModel,
  CashflowPassportActivationStatus,
  UserModel,
} from '../models';
import { RewardMintBuilder, getCashflowPassportActivationFeeLamports } from '../managers/RewardMintBuilder';
import { enqueueClaimableAttributes } from './badgeAttributeService';

const builder = new RewardMintBuilder();

const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const rpc: Rpc<SolanaRpcApi> = createSolanaRpc(rpcUrl);

export type ConfirmOutcome = 'confirmed' | 'failed' | 'pending';

export interface ActivationBuildResult {
  activationId: string;
  assetAddress: string;
  collectionAddress: string;
  innerInstructions: Awaited<ReturnType<RewardMintBuilder['buildCashflowPassportMintTransaction']>>['innerInstructions'];
  mintTransactionBase64: string;
  blockhash: string;
  mintFeeLamports: string;
}

/**
 * Build a Cashflow Passport activation transaction for a vault. Persists a
 * PENDING activation row and returns the data the mobile needs to bundle in
 * the vault's Squads execute.
 *
 * If the user already has a Cashflow Passport, throws — caller should branch
 * on the `User.cashflowPassportAddress` field before calling this.
 *
 * If a PENDING activation already exists, fail it (the previous attempt likely
 * never landed) and create a new one. Recovery cron can reconcile by checking
 * signatures onchain.
 */
/** Gas + Jito tip headroom required on top of the mint fee, in lamports. */
const ACTIVATION_GAS_BUFFER_LAMPORTS = 2_000_000n; // 0.002 SOL

export class InsufficientBalanceError extends Error {
  constructor(public readonly required: bigint, public readonly available: bigint) {
    super(`Insufficient SOL balance: need ${formatSol(required)} SOL, vault has ${formatSol(available)} SOL`);
    this.name = 'InsufficientBalanceError';
  }
}

function formatSol(lamports: bigint): string {
  return (Number(lamports) / 1_000_000_000).toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export async function buildActivation(vaultAddress: string): Promise<ActivationBuildResult> {
  const user = await UserModel.findOne({ vaultAddress }, { cashflowPassportAddress: 1 }).lean();
  if (user?.cashflowPassportAddress) {
    throw new Error('Cashflow Passport already activated');
  }

  const feeLamportsBig = getCashflowPassportActivationFeeLamports();
  const required = feeLamportsBig + ACTIVATION_GAS_BUFFER_LAMPORTS;

  // Vault SOL balance check — bail early with a clear message rather than
  // letting the transaction fail onchain after the user pays gas.
  const balanceRes = await rpc.getBalance(address(vaultAddress)).send();
  const available = BigInt(balanceRes.value);
  if (available < required) {
    throw new InsufficientBalanceError(required, available);
  }

  // Drop any old PENDING activation for this vault — retrying replaces it.
  await CashflowPassportActivationModel.updateMany(
    { vaultAddress, status: CashflowPassportActivationStatus.PENDING },
    { $set: { status: CashflowPassportActivationStatus.FAILED } },
  );

  const built = await builder.buildCashflowPassportMintTransaction({ vaultAddress });
  const feeLamports = feeLamportsBig.toString();

  const activation = await CashflowPassportActivationModel.create({
    vaultAddress,
    assetAddress: built.assetAddress,
    collectionAddress: built.collectionAddress,
    status: CashflowPassportActivationStatus.PENDING,
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
 * Record bundle signatures from the mobile and try to verify onchain
 * synchronously. On confirm, writes User.cashflowPassportAddress and triggers
 * the auto-add for any already-claimable badges.
 */
export async function recordAndConfirmActivation(
  activationId: string,
  vaultAddress: string,
  bundleSignatures: string[],
): Promise<ConfirmOutcome> {
  const activation = await CashflowPassportActivationModel.findOne({ _id: activationId, vaultAddress });
  if (!activation) throw new Error('Activation not found');

  activation.bundleSignatures = bundleSignatures;
  if (activation.status === CashflowPassportActivationStatus.PENDING) {
    await activation.save();
  }

  return tryConfirmActivation(activation);
}

/**
 * Check signatures onchain. Promote PENDING → CONFIRMED + write User
 * fields + enqueue badge auto-adds. Or PENDING → FAILED. Returns 'pending'
 * if signatures haven't landed yet.
 */
export async function tryConfirmActivation(activation: any): Promise<ConfirmOutcome> {
  if (activation.status === CashflowPassportActivationStatus.CONFIRMED) return 'confirmed';
  if (activation.status === CashflowPassportActivationStatus.FAILED) return 'failed';

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
    activation.status = CashflowPassportActivationStatus.FAILED;
    await activation.save();
    return 'failed';
  }
  if (!allUnknown && allConfirmed) {
    activation.status = CashflowPassportActivationStatus.CONFIRMED;
    await activation.save();

    await UserModel.updateOne(
      { vaultAddress: activation.vaultAddress },
      { $set: { cashflowPassportAddress: activation.assetAddress, cashflowPassportActivatedAt: new Date() } },
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
  activation.status = CashflowPassportActivationStatus.FAILED;
  await activation.save();
}
