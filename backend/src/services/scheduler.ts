import cron from 'node-cron';
import { createSolanaRpc } from '@solana/kit';
import type { Rpc, SolanaRpcApi, Signature } from '@solana/kit';
import { JupiterManager, KaminoManager, DriftManager, DBManager, PriceManager } from '../managers';
import { TransactionStatus } from '../models';

const jupiterManager = new JupiterManager();
const kaminoManager = new KaminoManager();
const dbManager = new DBManager();
const priceManager = new PriceManager();

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

  console.log('✅ Cron scheduler initialized');
  console.log('📋 Scheduled tasks:');
  console.log('  - Token prices: Every minute');
  console.log('  - Jupiter Earn tokens: Every minute');
  console.log('  - Kamino Earn tokens: Every minute');
  if (driftManager) {
    console.log('  - Drift Earn tokens: Every minute');
  }
  console.log('  - Confirm transactions: Every 30 seconds');

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
