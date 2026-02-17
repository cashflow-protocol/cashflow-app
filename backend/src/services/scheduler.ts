import cron from 'node-cron';
import { JupiterManager, KaminoManager } from '../managers';

const jupiterManager = new JupiterManager();
const kaminoManager = new KaminoManager();

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
 * Initialize all scheduled tasks
 */
export function initializeScheduler() {
  console.log('⏰ Initializing cron scheduler...');

  // Fetch Jupiter Earn tokens every minute
  cron.schedule('* * * * *', updateJupiterEarnTokens, {
    timezone: 'UTC',
  });

  // Fetch Kamino Earn tokens every minute
  cron.schedule('* * * * *', updateKaminoEarnTokens, {
    timezone: 'UTC',
  });

  console.log('✅ Cron scheduler initialized');
  console.log('📋 Scheduled tasks:');
  console.log('  - Jupiter Earn tokens: Every minute');
  console.log('  - Kamino Earn tokens: Every minute');

  // Run immediately on startup
  updateJupiterEarnTokens();
  updateKaminoEarnTokens();
}

export default {
  initializeScheduler,
};
