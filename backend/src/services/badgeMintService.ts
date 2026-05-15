import { createSolanaRpc } from '@solana/kit';
import type { Rpc, SolanaRpcApi, Signature } from '@solana/kit';
import {
  BadgeMintAttemptModel,
  BadgeMintAttemptStatus,
  RewardTaskModel,
  UserModel,
  UserRewardProgressModel,
  RewardProgressStatus,
  NotificationType,
} from '../models';
import { RewardMintBuilder } from '../managers/RewardMintBuilder';
import { dispatchSystemNotification } from './notificationService';
import type { SerializedInstruction } from '../types';

const builder = new RewardMintBuilder();

const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const rpc: Rpc<SolanaRpcApi> = createSolanaRpc(rpcUrl);

export type BadgeMintConfirmOutcome = 'confirmed' | 'failed' | 'pending';

export interface BadgeMintBuildResult {
  badgeMintId: string;
  assetAddress: string;
  collectionAddress: string;
  updatePluginInstructions: SerializedInstruction[];
}

export class PassportNotActivatedError extends Error {
  constructor() {
    super('Cashflow Passport is required before minting badges');
    this.name = 'PassportNotActivatedError';
  }
}

export class TaskNotClaimableError extends Error {
  constructor(public readonly status: string) {
    super(`Reward is not claimable (status: ${status})`);
    this.name = 'TaskNotClaimableError';
  }
}

export class TaskSoldOutError extends Error {
  constructor() {
    super('This badge is sold out');
    this.name = 'TaskSoldOutError';
  }
}

export class TaskInactiveError extends Error {
  constructor() {
    super('This reward is no longer active');
    this.name = 'TaskInactiveError';
  }
}

/**
 * Build a badge mint transaction for a vault. Atomically claims a supply slot
 * (if first attempt), marks progress MINT_PENDING, and returns the data the
 * mobile needs to bundle into the vault's Squads execute.
 *
 * Pattern mirrors cashflowPassportService.buildActivation. Old PENDING attempts
 * are marked FAILED so a single retry replaces the previous build.
 */
export async function buildBadgeMint(
  vaultAddress: string,
  taskSlug: string,
): Promise<BadgeMintBuildResult> {
  const user = await UserModel.findOne({ vaultAddress }, { cashflowPassportAddress: 1 }).lean();
  if (!user?.cashflowPassportAddress) {
    throw new PassportNotActivatedError();
  }

  const progress = await UserRewardProgressModel.findOne({ vaultAddress, taskSlug }, { status: 1 }).lean();
  if (!progress) {
    throw new TaskNotClaimableError('not_started');
  }
  if (progress.status === RewardProgressStatus.MINTED) {
    throw new TaskNotClaimableError('already_minted');
  }
  if (
    progress.status !== RewardProgressStatus.CLAIMABLE &&
    progress.status !== RewardProgressStatus.MINT_PENDING
  ) {
    throw new TaskNotClaimableError(progress.status);
  }

  // First-attempt slot claim. If the previous attempt already claimed and is
  // MINT_PENDING, we don't double-claim — we just rebuild.
  let claimedTask;
  if (progress.status === RewardProgressStatus.CLAIMABLE) {
    claimedTask = await RewardTaskModel.findOneAndUpdate(
      {
        slug: taskSlug,
        active: true,
        $or: [
          { maxSupply: null },
          { $expr: { $lt: ['$mintedCount', '$maxSupply'] } },
        ],
      },
      { $inc: { mintedCount: 1 } },
      { returnDocument: 'after' },
    );
    if (!claimedTask) {
      const existing = await RewardTaskModel.findOne({ slug: taskSlug }).lean();
      if (!existing || !existing.active) throw new TaskInactiveError();
      throw new TaskSoldOutError();
    }
    await UserRewardProgressModel.updateOne(
      { vaultAddress, taskSlug },
      { $set: { status: RewardProgressStatus.MINT_PENDING } },
    );
  } else {
    claimedTask = await RewardTaskModel.findOne({ slug: taskSlug }).lean();
    if (!claimedTask) throw new TaskInactiveError();
  }

  // Drop any old PENDING attempt — retrying replaces it.
  await BadgeMintAttemptModel.updateMany(
    { vaultAddress, taskSlug, status: BadgeMintAttemptStatus.PENDING },
    { $set: { status: BadgeMintAttemptStatus.FAILED } },
  );

  const built = await builder.buildBadgeMintTransaction({
    assetAddress: user.cashflowPassportAddress,
    key: taskSlug,
    value: claimedTask.imageUrl,
  });

  const attempt = await BadgeMintAttemptModel.create({
    vaultAddress,
    taskSlug,
    assetAddress: user.cashflowPassportAddress,
    collectionAddress: built.collectionAddress,
    status: BadgeMintAttemptStatus.PENDING,
    bundleSignatures: [],
    feeAmount: '0',
  });

  return {
    badgeMintId: String(attempt._id),
    assetAddress: user.cashflowPassportAddress,
    collectionAddress: built.collectionAddress,
    updatePluginInstructions: built.updatePluginInstructions,
  };
}

/**
 * Record bundle signatures from the mobile and verify onchain. Promotes the
 * attempt to CONFIRMED + flips progress to MINTED on success, or rolls back
 * the slot claim and resets progress to CLAIMABLE on failure.
 */
export async function recordAndConfirmBadgeMint(
  badgeMintId: string,
  vaultAddress: string,
  bundleSignatures: string[],
): Promise<BadgeMintConfirmOutcome> {
  const attempt = await BadgeMintAttemptModel.findOne({ _id: badgeMintId, vaultAddress });
  if (!attempt) throw new Error('Badge mint attempt not found');

  attempt.bundleSignatures = bundleSignatures;
  if (attempt.status === BadgeMintAttemptStatus.PENDING) {
    await attempt.save();
  }

  return tryConfirmBadgeMint(attempt);
}

export async function tryConfirmBadgeMint(attempt: any): Promise<BadgeMintConfirmOutcome> {
  if (attempt.status === BadgeMintAttemptStatus.CONFIRMED) return 'confirmed';
  if (attempt.status === BadgeMintAttemptStatus.FAILED) return 'failed';

  const sigs = attempt.bundleSignatures.filter((s: string | undefined): s is string => !!s);
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
    attempt.status = BadgeMintAttemptStatus.FAILED;
    await attempt.save();
    // Roll back slot + progress so the user can retry.
    await RewardTaskModel.updateOne(
      { slug: attempt.taskSlug },
      { $inc: { mintedCount: -1 } },
    ).catch(() => {});
    await UserRewardProgressModel.updateOne(
      { vaultAddress: attempt.vaultAddress, taskSlug: attempt.taskSlug, status: RewardProgressStatus.MINT_PENDING },
      { $set: { status: RewardProgressStatus.CLAIMABLE } },
    ).catch(() => {});
    return 'failed';
  }
  if (!allUnknown && allConfirmed) {
    attempt.status = BadgeMintAttemptStatus.CONFIRMED;
    await attempt.save();

    await UserRewardProgressModel.updateOne(
      { vaultAddress: attempt.vaultAddress, taskSlug: attempt.taskSlug },
      { $set: { status: RewardProgressStatus.MINTED, completedAt: new Date() } },
    );

    const task = await RewardTaskModel.findOne({ slug: attempt.taskSlug }, { title: 1 }).lean();
    dispatchSystemNotification(
      attempt.vaultAddress,
      `You earned the ${task?.title ?? 'reward'} badge`,
      undefined,
      NotificationType.BADGE_MINTED,
    ).catch((err) => console.error('[badgeMint] notify error:', err));

    return 'confirmed';
  }
  return 'pending';
}
