import crypto from 'crypto';
import cron from 'node-cron';
import { createSolanaRpc } from '@solana/kit';
import type { Rpc, SolanaRpcApi, Signature } from '@solana/kit';
import { JupiterManager, KaminoManager, DriftManager, PerenaManager, SolomonManager, OnreManager, HumaManager, DBManager, PriceManager, TokenManager } from '../managers';
import { TransactionStatus, InviteCodeModel, WaitlistUserModel, UserModel } from '../models';
import { NotificationType } from '../models';
import { CashflowPassportActivationModel, CashflowPassportActivationStatus } from '../models/CashflowPassportActivation';
import { BadgeMintAttemptModel, BadgeMintAttemptStatus } from '../models/BadgeMintAttempt';
import { RewardProgressStatus, UserRewardProgressModel } from '../models/UserRewardProgress';
import { RewardTaskModel } from '../models/RewardTask';
import { tryConfirmActivation, failActivation } from './cashflowPassportService';
import { tryConfirmBadgeMint } from './badgeMintService';
import { dispatchSystemNotification } from './notificationService';
import { sendWaitlistPushNotification, cleanupExpiredRTDBNotifications } from './firebaseManager';
import { onTransactionConfirmed } from './feeService';

const jupiterManager = new JupiterManager();
const kaminoManager = new KaminoManager();
const perenaManager = new PerenaManager();
const solomonManager = new SolomonManager();
const onreManager = new OnreManager();
const humaManager = new HumaManager();
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
 * Fetch and update Huma Earn tokens
 */
async function updateHumaEarnTokens() {
  try {
    console.log('🔄 [Cron] Starting Huma Earn tokens update...');
    await humaManager.getEarnTokens();
    console.log('✅ [Cron] Huma Earn tokens update completed');
  } catch (error) {
    console.error('❌ [Cron] Failed to update Huma Earn tokens:', error);
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
          console.log(`[Cron] Transaction ${tx.signature} FAILED (timeout)`);
        }
        continue;
      }

      if (status.err) {
        const transitioned = await dbManager.confirmTransaction(String(tx._id), TransactionStatus.FAILED);
        if (transitioned) {
          console.log(`[Cron] Transaction ${tx.signature} FAILED`);
        }
      } else if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
        const transitioned = await dbManager.confirmTransaction(String(tx._id), TransactionStatus.CONFIRMED);
        if (transitioned) {
          await onTransactionConfirmed(String(tx._id));
          console.log(`[Cron] Transaction ${tx.signature} CONFIRMED`);
        }
      }
    }
  } catch (error) {
    console.error('[Cron] Failed to confirm transactions:', error);
  }
}

/**
 * Approve top 5 users by XP every 12 hours.
 * Generates invite codes and updates their status.
 */
async function approveTopWaitlistUsers() {
  try {
    const topUsers = await WaitlistUserModel.find({ status: 'waiting', xp: { $gt: 0 } })
      .sort({ xp: -1, lastXpAt: 1 })
      .limit(5)
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

/** Recovery windows for pending Metaplex ops (Cashflow Passport activations). */
const RECOVER_GRACE_MS = 10 * 60 * 1000;
const RECOVER_FAIL_AFTER_MS = 30 * 60 * 1000;

async function recoverPendingBadgeMints() {
  try {
    const cutoff = new Date(Date.now() - RECOVER_GRACE_MS);
    const pending = await BadgeMintAttemptModel.find({
      status: BadgeMintAttemptStatus.PENDING,
      createdAt: { $lte: cutoff },
    }).limit(100);

    if (pending.length === 0) return;
    console.log(`[Cron] recoverPendingBadgeMints: ${pending.length} pending`);

    for (const attempt of pending) {
      const createdAt = (attempt as any).createdAt as Date | undefined;
      const expired = createdAt && Date.now() - createdAt.getTime() > RECOVER_FAIL_AFTER_MS;
      try {
        if (attempt.bundleSignatures.filter((s) => !!s).length === 0) {
          if (expired) {
            attempt.status = BadgeMintAttemptStatus.FAILED;
            await attempt.save();
            await RewardTaskModel.updateOne({ slug: attempt.taskSlug }, { $inc: { mintedCount: -1 } }).catch(() => {});
            await UserRewardProgressModel.updateOne(
              { vaultAddress: attempt.vaultAddress, taskSlug: attempt.taskSlug, status: RewardProgressStatus.MINT_PENDING },
              { $set: { status: RewardProgressStatus.CLAIMABLE } },
            ).catch(() => {});
          }
          continue;
        }
        const outcome = await tryConfirmBadgeMint(attempt);
        if (outcome === 'confirmed') {
          console.log(`[Cron] Badge mint ${attempt.taskSlug}/${attempt.vaultAddress} CONFIRMED`);
        } else if (outcome === 'pending' && expired) {
          attempt.status = BadgeMintAttemptStatus.FAILED;
          await attempt.save();
          await RewardTaskModel.updateOne({ slug: attempt.taskSlug }, { $inc: { mintedCount: -1 } }).catch(() => {});
          await UserRewardProgressModel.updateOne(
            { vaultAddress: attempt.vaultAddress, taskSlug: attempt.taskSlug, status: RewardProgressStatus.MINT_PENDING },
            { $set: { status: RewardProgressStatus.CLAIMABLE } },
          ).catch(() => {});
        }
      } catch (err) {
        console.error(`[Cron] Recovery error for badge mint ${attempt._id}:`, err);
      }
    }
  } catch (error) {
    console.error('[Cron] Failed to recover pending badge mints:', error);
  }
}

async function recoverPendingActivations() {
  try {
    const cutoff = new Date(Date.now() - RECOVER_GRACE_MS);
    const pending = await CashflowPassportActivationModel.find({
      status: CashflowPassportActivationStatus.PENDING,
      createdAt: { $lte: cutoff },
    }).limit(100);

    if (pending.length === 0) return;
    console.log(`[Cron] recoverPendingActivations: ${pending.length} pending`);

    for (const activation of pending) {
      const createdAt = (activation as any).createdAt as Date | undefined;
      const expired = createdAt && Date.now() - createdAt.getTime() > RECOVER_FAIL_AFTER_MS;
      try {
        if (activation.bundleSignatures.filter((s) => !!s).length === 0) {
          if (expired) await failActivation(activation);
          continue;
        }
        const outcome = await tryConfirmActivation(activation);
        if (outcome === 'confirmed') {
          console.log(`[Cron] Cashflow Passport ${activation.assetAddress} CONFIRMED`);
        } else if (outcome === 'pending' && expired) {
          await failActivation(activation);
        }
      } catch (err) {
        console.error(`[Cron] Recovery error for activation ${activation._id}:`, err);
      }
    }
  } catch (error) {
    console.error('[Cron] Failed to recover pending activations:', error);
  }
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

  // Fetch Huma Earn tokens every hour (Classic APY updates monthly per Huma docs)
  cron.schedule('0 * * * *', updateHumaEarnTokens, {
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

  // Recover stuck Cashflow Passport activations every 5 minutes
  cron.schedule('*/5 * * * *', recoverPendingActivations, {
    timezone: 'UTC',
  });

  // Recover stuck badge mint attempts every 5 minutes
  cron.schedule('*/5 * * * *', recoverPendingBadgeMints, {
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
  console.log('  - Huma Earn tokens: Every hour');
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
  updateHumaEarnTokens();
  // if (driftManager) {
  //   updateDriftEarnTokens();
  // }
}

export default {
  initializeScheduler,
};
