import {
  RewardTaskModel,
  UserRewardProgressModel,
  RewardProgressStatus,
  UserModel,
  NotificationType,
} from '../models';
import { RewardMintBuilder } from '../managers/RewardMintBuilder';
import { dispatchSystemNotification } from './notificationService';

const builder = new RewardMintBuilder();

export type AttributeAddOutcome =
  | { status: 'no_cashflow_id' }
  | { status: 'already_minted' }
  | { status: 'sold_out' }
  | { status: 'task_inactive' }
  | { status: 'minted'; signature: string };

/**
 * Try to add a badge attribute on the user's Cashflow ID asset.
 *
 * Pre-conditions: caller has determined the verifier is satisfied (i.e.
 * UserRewardProgress.status was about to flip to CLAIMABLE).
 *
 * Flow:
 *   1. Resolve user's Cashflow ID — if missing, mark progress CLAIMABLE so the
 *      activation flow can pick it up later.
 *   2. Atomic slot claim against RewardTask.maxSupply.
 *   3. Mark progress MINT_PENDING.
 *   4. Admin keypair signs+sends updatePluginV1 — sync confirm.
 *   5. On success → MINTED + notification. On failure → rollback (mintedCount--,
 *      status back to CLAIMABLE).
 *
 * Idempotent: if the attribute is already present on the asset (e.g. a retry
 * after a partial failure), returns 'already_minted' without re-claiming a slot.
 */
export async function tryAddBadgeAttribute(
  userVaultAddress: string,
  taskSlug: string,
): Promise<AttributeAddOutcome> {
  const user = await UserModel.findOne({ vaultAddress: userVaultAddress }, { cashflowIdAddress: 1 }).lean();
  if (!user?.cashflowIdAddress) {
    // User hasn't activated yet — leave progress at CLAIMABLE so the
    // activation flow's enqueueClaimableAttributes picks it up later.
    await UserRewardProgressModel.updateOne(
      { vaultAddress: userVaultAddress, taskSlug, status: { $ne: RewardProgressStatus.MINTED } },
      { $set: { status: RewardProgressStatus.CLAIMABLE, completedAt: new Date() } },
    );
    return { status: 'no_cashflow_id' };
  }

  // Already minted? Short-circuit.
  const existingProgress = await UserRewardProgressModel.findOne(
    { vaultAddress: userVaultAddress, taskSlug },
    { status: 1 },
  ).lean();
  if (existingProgress?.status === RewardProgressStatus.MINTED) {
    return { status: 'already_minted' };
  }

  // Atomic slot claim — supply-cap enforcement.
  const claimedTask = await RewardTaskModel.findOneAndUpdate(
    {
      slug: taskSlug,
      active: true,
      $or: [
        { maxSupply: null },
        { $expr: { $lt: ['$mintedCount', '$maxSupply'] } },
      ],
    },
    { $inc: { mintedCount: 1 } },
    { new: true },
  );
  if (!claimedTask) {
    const existing = await RewardTaskModel.findOne({ slug: taskSlug }).lean();
    if (!existing || !existing.active) return { status: 'task_inactive' };
    return { status: 'sold_out' };
  }

  // Mark in-flight so the recovery cron can reconcile if we crash mid-send.
  await UserRewardProgressModel.findOneAndUpdate(
    { vaultAddress: userVaultAddress, taskSlug },
    {
      $set: {
        status: RewardProgressStatus.MINT_PENDING,
        currentValue: existingProgress?.status === RewardProgressStatus.CLAIMABLE ? undefined : '1',
        targetValue: '1',
      },
      $setOnInsert: { vaultAddress: userVaultAddress, taskSlug },
    },
    { upsert: true, new: true },
  );

  try {
    const signature = await builder.appendBadgeAttribute({
      assetAddress: user.cashflowIdAddress,
      key: taskSlug,
      value: claimedTask.imageUrl,
    });

    await UserRewardProgressModel.updateOne(
      { vaultAddress: userVaultAddress, taskSlug },
      {
        $set: {
          status: RewardProgressStatus.MINTED,
          completedAt: new Date(),
        },
      },
    );

    dispatchSystemNotification(
      userVaultAddress,
      `You earned the ${claimedTask.title} badge`,
      undefined,
      NotificationType.BADGE_MINTED,
    ).catch((err) => console.error('[badgeAttribute] notify error:', err));

    return { status: 'minted', signature };
  } catch (err) {
    console.error(`[badgeAttribute] append failed for ${taskSlug} on ${userVaultAddress}:`, err);
    // Rollback the slot + progress so the user can retry naturally.
    await RewardTaskModel.updateOne({ slug: taskSlug }, { $inc: { mintedCount: -1 } }).catch(() => {});
    await UserRewardProgressModel.updateOne(
      { vaultAddress: userVaultAddress, taskSlug, status: RewardProgressStatus.MINT_PENDING },
      { $set: { status: RewardProgressStatus.CLAIMABLE } },
    ).catch(() => {});
    throw err;
  }
}

/**
 * After Cashflow ID activation confirms, scan all of this vault's CLAIMABLE
 * progress rows and try to add an attribute for each. Failures are swallowed
 * per-badge so one bad badge doesn't block the rest.
 */
export async function enqueueClaimableAttributes(userVaultAddress: string): Promise<void> {
  const claimable = await UserRewardProgressModel.find(
    { vaultAddress: userVaultAddress, status: RewardProgressStatus.CLAIMABLE },
    { taskSlug: 1 },
  ).lean();

  for (const progress of claimable) {
    try {
      await tryAddBadgeAttribute(userVaultAddress, progress.taskSlug);
    } catch (err) {
      console.error(`[enqueueClaimable] ${progress.taskSlug} failed:`, err);
    }
  }
}
