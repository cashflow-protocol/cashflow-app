import crypto from 'crypto';
import cron from 'node-cron';
import { createSolanaRpc } from '@solana/kit';
import type { Rpc, SolanaRpcApi, Signature } from '@solana/kit';
import { JupiterManager, KaminoManager, DriftManager, DBManager, PriceManager, TokenManager } from '../managers';
import { TransactionStatus, InviteCodeModel, WaitlistUserModel, UserModel } from '../models';
import { NotificationType } from '../models';
import { dispatchSystemNotification } from './notificationService';

const jupiterManager = new JupiterManager();
const kaminoManager = new KaminoManager();
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
        // If not found on-chain after 5 minutes, mark as failed
        const updatedAt = new Date((tx as any).updatedAt).getTime();
        if (Date.now() - updatedAt > 5 * 60 * 1000) {
          await dbManager.confirmTransaction(String(tx._id), TransactionStatus.FAILED);
          console.log(`[Cron] Transaction ${tx.signature} FAILED (timeout)`);
        }
        continue;
      }

      if (status.err) {
        await dbManager.confirmTransaction(String(tx._id), TransactionStatus.FAILED);
        console.log(`[Cron] Transaction ${tx.signature} FAILED`);
      } else if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
        await dbManager.confirmTransaction(String(tx._id), TransactionStatus.CONFIRMED);
        console.log(`[Cron] Transaction ${tx.signature} CONFIRMED`);
      }
    }
  } catch (error) {
    console.error('[Cron] Failed to confirm transactions:', error);
  }
}

/**
 * Approve top 5 waitlist users by XP every 12 hours.
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

      // Send push notification if user already has a vault
      const appUser = await UserModel.findOne({ waitlistUserId: String(user._id) }).lean();
      if (appUser) {
        dispatchSystemNotification(
          appUser.vaultAddress,
          'Your waitlist approved. Try Cashflow now!',
          undefined,
          NotificationType.WAITLIST_APPROVED,
        ).catch((err) => console.error('Waitlist notification error:', err));
      }
    }

    console.log(`[Cron] Waitlist approval batch complete`);
  } catch (error) {
    console.error('[Cron] Failed to approve waitlist users:', error);
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

  // Fetch Drift Earn tokens every minute
  if (driftManager) {
    cron.schedule('* * * * *', updateDriftEarnTokens, {
      timezone: 'UTC',
    });
  }

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

  console.log('✅ Cron scheduler initialized');
  console.log('📋 Scheduled tasks:');
  console.log('  - Token prices: Every minute');
  console.log('  - Jupiter Earn tokens: Every minute');
  console.log('  - Kamino Earn tokens: Every minute');
  if (driftManager) {
    console.log('  - Drift Earn tokens: Every minute');
  }
  console.log('  - Confirm transactions: Every 30 seconds');
  console.log('  - Cached token cleanup: Every 5 minutes');
  console.log('  - Waitlist approval batch: Every 12 hours (00:00, 12:00 UTC)');

  // Run immediately on startup
  updatePrices();
  updateJupiterEarnTokens();
  updateKaminoEarnTokens();
  if (driftManager) {
    updateDriftEarnTokens();
  }
}

export default {
  initializeScheduler,
};
