import { createSolanaRpc } from '@solana/kit';
import type { Rpc, SolanaRpcApi, Signature } from '@solana/kit';
import { MintedBadgeModel, MintedBadgeStatus } from '../models/MintedBadge';
import { UserRewardProgressModel, RewardProgressStatus } from '../models/UserRewardProgress';
import { RewardTaskModel } from '../models/RewardTask';
import { NotificationType } from '../models';
import { dispatchSystemNotification } from './notificationService';

const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const rpc: Rpc<SolanaRpcApi> = createSolanaRpc(rpcUrl);

export type ConfirmOutcome = 'confirmed' | 'failed' | 'pending';

/**
 * Check a pending MintedBadge against on-chain signature status. Promotes to
 * CONFIRMED + flips UserRewardProgress to MINTED, or FAILED + rolls back the
 * slot. Returns 'pending' if signatures haven't landed yet.
 */
export async function tryConfirmBadgeMint(badge: any): Promise<ConfirmOutcome> {
  const sigs = badge.bundleSignatures.filter((s: string | undefined): s is string => !!s);
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
    await failBadgeMint(badge);
    return 'failed';
  }
  if (!allUnknown && allConfirmed) {
    badge.status = MintedBadgeStatus.CONFIRMED;
    await badge.save();
    await UserRewardProgressModel.updateOne(
      { vaultAddress: badge.vaultAddress, taskSlug: badge.taskSlug },
      { $set: { status: RewardProgressStatus.MINTED, completedAt: new Date(), mintedBadgeId: String(badge._id) } },
    );
    dispatchSystemNotification(
      badge.vaultAddress,
      'Badge minted',
      `Your "${badge.taskSlug}" badge is now in your vault.`,
      NotificationType.BADGE_MINTED,
    ).catch((err) => console.error('Badge minted notification error:', err));
    return 'confirmed';
  }
  return 'pending';
}

export async function failBadgeMint(badge: any): Promise<void> {
  badge.status = MintedBadgeStatus.FAILED;
  await badge.save();
  await UserRewardProgressModel.updateOne(
    { vaultAddress: badge.vaultAddress, taskSlug: badge.taskSlug, status: RewardProgressStatus.MINT_PENDING },
    { $set: { status: RewardProgressStatus.CLAIMABLE } },
  );
  await RewardTaskModel.updateOne({ slug: badge.taskSlug }, { $inc: { mintedCount: -1 } });
}

export { MintedBadgeModel };
