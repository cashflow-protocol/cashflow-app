import 'dotenv/config';
import mongoose from 'mongoose';
import { rebuildUserCostBasis } from '../services/maintenanceService';

/**
 * Rebuild UserCostBasis from confirmed deposit/withdraw transactions.
 * See services/maintenanceService.ts for details.
 *
 * Usage:
 *   tsx rebuildUserCostBasis.ts            # apply
 *   tsx rebuildUserCostBasis.ts --dry-run  # report only
 */
async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI must be set');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');

  await mongoose.connect(uri);
  console.log(`Connected to MongoDB${dryRun ? ' (dry run)' : ''}`);

  const report = await rebuildUserCostBasis({ dryRun });

  console.log(`\nDeposits scanned:    ${report.totalDepositsScanned}`);
  console.log(`Withdrawals scanned: ${report.totalWithdrawalsScanned}`);
  console.log(`Ignored (missing userVaultAddress): ${report.ignoredMissingVault}`);
  console.log(`\n(vault, mint) keys:  ${report.aggregatedKeys}`);
  console.log(`Would create:        ${report.wouldCreate}`);
  console.log(`Would update:        ${report.wouldUpdate}`);
  console.log(`Unchanged:           ${report.unchanged}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('rebuildUserCostBasis failed:', err);
  process.exit(1);
});
