import crypto from 'crypto';
import cron from 'node-cron';
import { createSolanaRpc } from '@solana/kit';
import type { Rpc, SolanaRpcApi, Signature } from '@solana/kit';
import { JupiterManager, KaminoManager, DriftManager, PerenaManager, SolomonManager, OnreManager, DBManager, PriceManager, TokenManager } from '../managers';
import { TransactionStatus, InviteCodeModel, WaitlistUserModel, UserModel } from '../models';
import { NotificationType } from '../models';
import { MintedBadgeModel, MintedBadgeStatus } from '../models/MintedBadge';
import { UserRewardProgressModel, RewardProgressStatus } from '../models/UserRewardProgress';
import { RewardTaskModel } from '../models/RewardTask';
import { dispatchSystemNotification } from './notificationService';
import { sendWaitlistPushNotification, cleanupExpiredRTDBNotifications } from './firebaseManager';
import { updateCostBasisOnConfirm, markFeeTransactionFailed } from './feeService';

const jupiterManager = new JupiterManager();
const kaminoManager = new KaminoManager();
const perenaManager = new PerenaManager();
const solomonManager = new SolomonManager();
const onreManager = new OnreManager();
const dbManager = new DBManager();
const priceManager = new PriceManager();
const tokenManager = new TokenManager();

const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const rpc: Rpc<SolanaRpcApi> = createSolanaRpc(rpcUrl);

// DriftManager requires SOLANA_RPC_URL and DRIFT_PRIVATE_KEY
let driftManager: DriftManager | null = null;
try {
  driftManager = new DriftManager();
} catch (error) {
  console.warn('⚠️ [Drift] DriftManager not initialized:', (error as Error).message);
}

/**
 * Fetch and update Jupiter Earn tokens
 */
async function updateJupiterEarnTokens() {
  try {
    console.log('🔄 [Cron] Starting Jupiter Earn tokens update...');
    await jupiterManager.getEarnTokens();
    console.log('✅ [Cron] Jupiter Earn tokens update completed');
  } catch (error) {
    console.error('❌ [Cron] Failed to update Jupiter Earn tokens:', error);
  }
}

/**
 * Fetch and update Kamino Earn tokens
 */
async function updateKaminoEarnTokens() {
  try {
    console.log('🔄 [Cron] Starting Kamino Earn tokens update...');
    await kaminoManager.getEarnTokens();
    console.log('✅ [Cron] Kamino Earn tokens update completed');
  } catch (error) {
    console.error('❌ [Cron] Failed to update Kamino Earn tokens:', error);
  }
}

/**
 * Fetch and update Drift Earn tokens
 */
async function updateDriftEarnTokens() {
  if (!driftManager) return;
  try {
    console.log('🔄 [Cron] Starting Drift Earn tokens update...');
    await driftManager.getEarnTokens();
    console.log('✅ [Cron] Drift Earn tokens update completed');
  } catch (error) {
    console.error('❌ [Cron] Failed to update Drift Earn tokens:', error);
  }
}

/**
 * Fetch and update Perena Earn tokens
 */
async function updatePerenaEarnTokens() {
  try {
    console.log('🔄 [Cron] Starting Perena Earn tokens update...');
    await perenaManager.getEarnTokens();
    console.log('✅ [Cron] Perena Earn tokens update completed');
  } catch (error) {
    console.error('❌ [Cron] Failed to update Perena Earn tokens:', error);
  }
}

/**
 * Fetch and update Solomon Earn tokens
 */
async function updateSolomonEarnTokens() {
  try {
    console.log('🔄 [Cron] Starting Solomon Earn tokens update...');
    await solomonManager.getEarnTokens();
    console.log('✅ [Cron] Solomon Earn tokens update completed');
  } catch (error) {
    console.error('❌ [Cron] Failed to update Solomon Earn tokens:', error);
  }
}

/**
 * Fetch and update Onre Earn tokens
 */
async function updateOnreEarnTokens() {
  try {
    console.log('🔄 [Cron] Starting Onre Earn tokens update...');
    await onreManager.getEarnTokens();
    console.log('✅ [Cron] Onre Earn tokens update completed');
  } catch (error) {
    console.error('❌ [Cron] Failed to update Onre Earn tokens:', error);
  }
}

/**
 * Fetch token prices from Binance
 */
async function updatePrices() {
  await priceManager.fetchPrices();
}

/**
 * Check submitted transactions and update their status to confirmed or failed
 */
async function confirmTransactions() {
  try {
    const submitted = await dbManager.getSubmittedTransactions();
    if (submitted.length === 0) return;

    console.log(`[Cron] Checking ${submitted.length} submitted transaction(s)...`);

    const signatures = submitted.map((tx) => tx.signature as Signature);

    const statuses = await rpc
      .getSignatureStatuses(signatures, { searchTransactionHistory: true })
      .send();

    for (let i = 0; i < submitted.length; i++) {
      const tx = submitted[i];
      const status = statuses.value[i];

      if (!status) {
        // If not found onchain after 5 minutes, mark as failed
        const updatedAt = new Date((tx as any).updatedAt).getTime();
        if (Date.now() - updatedAt > 5 * 60 * 1000) {
          await dbManager.confirmTransaction(String(tx._id), TransactionStatus.FAILED);
          await markFeeTransactionFailed(String(tx._id));
          console.log(`[Cron] Transaction ${tx.signature} FAILED (timeout)`);
        }
        continue;
      }

      if (status.err) {
        const transitioned = await dbManager.confirmTransaction(String(tx._id), TransactionStatus.FAILED);
        if (transitioned) {
          await markFeeTransactionFailed(String(tx._id));
          console.log(`[Cron] Transaction ${tx.signature} FAILED`);
        }
      } else if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
        const transitioned = await dbManager.confirmTransaction(String(tx._id), TransactionStatus.CONFIRMED);
        if (transitioned) {
          await updateCostBasisOnConfirm(String(tx._id));
          console.log(`[Cron] Transaction ${tx.signature} CONFIRMED`);

          // Force reward verifiers to re-evaluate this vault's in-progress tasks
          // on the next read (clears the lastEvaluatedAt TTL cache).
          if (tx.vaultAddress) {
            await UserRewardProgressModel.updateMany(
              { vaultAddress: tx.vaultAddress, status: RewardProgressStatus.IN_PROGRESS },
              { $unset: { lastEvaluatedAt: '' } },
            ).catch((err) => console.error('[Cron] reward progress invalidation error:', err));
          }
        }
      }
    }
  } catch (error) {
    console.error('[Cron] Failed to confirm transactions:', error);
  }
}

/**
 * Approve top 1 users by XP every 12 hours.
 * Generates invite codes and updates their status.
 */
async function approveTopWaitlistUsers() {
  try {
    const topUsers = await WaitlistUserModel.find({ status: 'waiting', xp: { $gt: 0 } })
      .sort({ xp: -1, lastXpAt: 1 })
      .limit(1)
      .lean();

    if (topUsers.length === 0) {
      console.log('[Cron] No waitlist users to approve');
      return;
    }

    console.log(`[Cron] Approving ${topUsers.length} waitlist user(s)...`);

    for (const user of topUsers) {
      // Generate unique 8-char invite code
      let code: string;
      let attempts = 0;
      while (true) {
        code = crypto.randomBytes(4).toString('hex').toUpperCase();
        try {
          await InviteCodeModel.create({ code, maxUses: 1, useCount: 0, source: 'waitlist_batch' });
          break;
        } catch (err: any) {
          if (err.code === 11000 && attempts < 5) {
            attempts++;
            continue;
          }
          throw err;
        }
      }

      await WaitlistUserModel.findOneAndUpdate(
        { publicKey: user.publicKey, status: 'waiting' },
        { $set: { status: 'approved', inviteCode: code, approvedAt: new Date() } },
      );

      console.log(`  Approved ${user.publicKey.slice(0, 8)}... (${user.xp} XP) → code: ${code}`);

      // Send push notification
      const appUser = await UserModel.findOne({ waitlistUserId: String(user._id) }).lean();
      if (appUser) {
        dispatchSystemNotification(
          appUser.vaultAddress,
          'Your waitlist approved. Try Cashflow now!',
          undefined,
          NotificationType.WAITLIST_APPROVED,
        ).catch((err) => console.error('Waitlist notification error:', err));
      } else {
        // User hasn't created a vault yet — send via waitlist FCM tokens
        sendWaitlistPushNotification(
          user.publicKey,
          'Cashflow',
          'Your waitlist approved! Open the app to get started.',
          { type: 'waitlist_approved' },
        ).catch((err) => console.error('Waitlist push error:', err));
      }
    }

    console.log(`[Cron] Waitlist approval batch complete`);
  } catch (error) {
    console.error('[Cron] Failed to approve waitlist users:', error);
  }
}

/**
 * Recover pending Metaplex Core badge mints. For each MintedBadge in pending
 * status older than the grace window, query its bundleSignatures on-chain.
 * Promote to confirmed (and update UserRewardProgress) or failed (rolling
 * back the slot + resetting progress to claimable).
 */
const RECOVER_GRACE_MS = 10 * 60 * 1000;
const RECOVER_FAIL_AFTER_MS = 30 * 60 * 1000;

async function recoverPendingMints() {
  try {
    const cutoff = new Date(Date.now() - RECOVER_GRACE_MS);
    const pending = await MintedBadgeModel.find({
      status: MintedBadgeStatus.PENDING,
      createdAt: { $lte: cutoff },
    }).limit(100);

    if (pending.length === 0) return;
    console.log(`[Cron] recoverPendingMints: ${pending.length} pending mint(s)`);

    for (const badge of pending) {
      const createdAt = (badge as any).createdAt as Date | undefined;
      try {
        const sigs = badge.bundleSignatures.filter((s): s is string => !!s);
        if (sigs.length === 0) {
          // No signatures recorded — if old enough, fail it.
          if (createdAt && Date.now() - createdAt.getTime() > RECOVER_FAIL_AFTER_MS) {
            await failMint(badge);
          }
          continue;
        }

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
          await failMint(badge);
        } else if (!allUnknown && allConfirmed) {
          badge.status = MintedBadgeStatus.CONFIRMED;
          await badge.save();
          await UserRewardProgressModel.updateOne(
            { vaultAddress: badge.vaultAddress, taskSlug: badge.taskSlug },
            { $set: { status: RewardProgressStatus.MINTED, completedAt: new Date(), mintedBadgeId: String(badge._id) } },
          );
          console.log(`[Cron] Mint ${badge.assetAddress} CONFIRMED`);

          dispatchSystemNotification(
            badge.vaultAddress,
            'Badge minted',
            `Your "${badge.taskSlug}" badge is now in your vault.`,
            NotificationType.BADGE_MINTED,
          ).catch((err) => console.error('Badge minted notification error:', err));
        } else if (allUnknown && createdAt && Date.now() - createdAt.getTime() > RECOVER_FAIL_AFTER_MS) {
          // Bundle signatures never landed.
          await failMint(badge);
        }
      } catch (err) {
        console.error(`[Cron] Recovery error for badge ${badge._id}:`, err);
      }
    }
  } catch (error) {
    console.error('[Cron] Failed to recover pending mints:', error);
  }
}

async function failMint(badge: any): Promise<void> {
  badge.status = MintedBadgeStatus.FAILED;
  await badge.save();
  // Reset progress to claimable so user can retry
  await UserRewardProgressModel.updateOne(
    { vaultAddress: badge.vaultAddress, taskSlug: badge.taskSlug, status: RewardProgressStatus.MINT_PENDING },
    { $set: { status: RewardProgressStatus.CLAIMABLE } },
  );
  // Roll back the slot
  await RewardTaskModel.updateOne({ slug: badge.taskSlug }, { $inc: { mintedCount: -1 } });
  console.log(`[Cron] Mint ${badge.assetAddress} FAILED — rolled back`);
}

/**
 * Initialize all scheduled tasks
 */
export async function initializeScheduler() {
  console.log('⏰ Initializing cron scheduler...');

  // Initialize DriftManager (must subscribe before first query)
  if (driftManager) {
    try {
      await driftManager.initialize();
    } catch (error) {
      console.error('❌ [Drift] Failed to initialize, disabling Drift updates:', error);
      driftManager = null;
    }
  }

  // Fetch token prices every minute
  cron.schedule('* * * * *', updatePrices, {
    timezone: 'UTC',
  });

  // Fetch Jupiter Earn tokens every minute
  cron.schedule('* * * * *', updateJupiterEarnTokens, {
    timezone: 'UTC',
  });

  // Fetch Kamino Earn tokens every minute
  cron.schedule('* * * * *', updateKaminoEarnTokens, {
    timezone: 'UTC',
  });

  // Fetch Perena Earn tokens every minute
  cron.schedule('* * * * *', updatePerenaEarnTokens, {
    timezone: 'UTC',
  });

  // Fetch Solomon Earn tokens every hour
  cron.schedule('0 * * * *', updateSolomonEarnTokens, {
    timezone: 'UTC',
  });

  // Fetch Onre Earn tokens every hour
  cron.schedule('0 * * * *', updateOnreEarnTokens, {
    timezone: 'UTC',
  });

  // Fetch Drift Earn tokens every minute
  // if (driftManager) {
  //   cron.schedule('* * * * *', updateDriftEarnTokens, {
  //     timezone: 'UTC',
  //   });
  // }

  // Confirm submitted transactions every 30 seconds
  cron.schedule('*/30 * * * * *', confirmTransactions, {
    timezone: 'UTC',
  });

  // Clean up stale cached tokens every 5 minutes
  cron.schedule('*/5 * * * *', () => tokenManager.cleanupStaleCache(), {
    timezone: 'UTC',
  });

  // Approve top 5 waitlist users every 12 hours (00:00 and 12:00 UTC)
  cron.schedule('0 0,12 * * *', approveTopWaitlistUsers, {
    timezone: 'UTC',
  });

  // Clean up expired RTDB notifications every 15 minutes
  cron.schedule('*/15 * * * *', () => cleanupExpiredRTDBNotifications(5 * 60 * 1000), {
    timezone: 'UTC',
  });

  // Recover stuck reward badge mints every 5 minutes
  cron.schedule('*/5 * * * *', recoverPendingMints, {
    timezone: 'UTC',
  });

  console.log('✅ Cron scheduler initialized');
  console.log('📋 Scheduled tasks:');
  console.log('  - Token prices: Every minute');
  console.log('  - Jupiter Earn tokens: Every minute');
  console.log('  - Kamino Earn tokens: Every minute');
  console.log('  - Perena Earn tokens: Every minute');
  console.log('  - Solomon Earn tokens: Every hour');
  console.log('  - Onre Earn tokens: Every hour');
  if (driftManager) {
    console.log('  - Drift Earn tokens: Every minute');
  }
  console.log('  - Confirm transactions: Every 30 seconds');
  console.log('  - Cached token cleanup: Every 5 minutes');
  console.log('  - Waitlist approval batch: Every 12 hours (00:00, 12:00 UTC)');
  console.log('  - RTDB notification cleanup: Every 15 minutes');

  // Run immediately on startup
  updatePrices();
  updateJupiterEarnTokens();
  updateKaminoEarnTokens();
  updatePerenaEarnTokens();
  updateSolomonEarnTokens();
  updateOnreEarnTokens();
  // if (driftManager) {
  //   updateDriftEarnTokens();
  // }
}

export default {
  initializeScheduler,
};
