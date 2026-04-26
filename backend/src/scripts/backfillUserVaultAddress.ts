import 'dotenv/config';
import mongoose from 'mongoose';
import { backfillUserVaultAddress } from '../services/maintenanceService';

/**
 * Backfill Transaction.userVaultAddress for deposit/withdraw rows that pre-date
 * the field. See services/maintenanceService.ts for mapping logic.
 *
 * Usage:
 *   tsx backfillUserVaultAddress.ts            # apply
 *   tsx backfillUserVaultAddress.ts --dry-run  # report only
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

  const report = await backfillUserVaultAddress({ dryRun });

  console.log(`\nMapping sources: ${report.mappingSourceCount}`);
  console.log(`Scanned (deposit/withdraw, missing userVaultAddress): ${report.scanned}`);
  console.log(`Mapped:   ${report.mapped}${dryRun ? ' (would update)' : ''}`);
  console.log(`Unmapped: ${report.unmapped}`);

  if (report.unmappedSample.length > 0) {
    console.log('\nTop unmapped walletAddress values:');
    for (const { address, count } of report.unmappedSample) {
      console.log(`  ${address} — ${count} tx`);
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('backfillUserVaultAddress failed:', err);
  process.exit(1);
});
