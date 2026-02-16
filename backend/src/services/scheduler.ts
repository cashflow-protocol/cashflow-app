import cron from 'node-cron';
import { JupiterManager } from '../managers';

const jupiterManager = new JupiterManager();

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
 * Initialize all scheduled tasks
 */
export function initializeScheduler() {
  console.log('⏰ Initializing cron scheduler...');

  // Fetch Jupiter Earn tokens every minute
  cron.schedule('* * * * *', updateJupiterEarnTokens, {
    timezone: 'UTC',
  });

  console.log('✅ Cron scheduler initialized');
  console.log('📋 Scheduled tasks:');
  console.log('  - Jupiter Earn tokens: Every minute');

  // Run immediately on startup
  updateJupiterEarnTokens();
}

export default {
  initializeScheduler,
};
