import 'dotenv/config';
import mongoose from 'mongoose';
import { TransactionModel } from '../models/Transaction';
import { UserModel } from '../models/User';
import { VaultPaymentModel } from '../models/VaultPayment';

/**
 * Backfill Transaction.userVaultAddress for records that pre-date the field.
 *
 * Mapping sources (in order of preference):
 *   1. VaultPayment.cloudKey → VaultPayment.vaultAddress
 *      Works for both Seeker and standard users.
 *   2. User.publicKey === Transaction.walletAddress → User.vaultAddress
 *      Works only for non-Seeker users (where the cloud key is the auth pubkey).
 *
 * Transactions whose walletAddress can't be mapped are left untouched and
 * reported at the end.
 */
async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI must be set');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  // Build cloudKey -> vaultAddress map from both sources.
  const cloudKeyToVault = new Map<string, string>();

  const payments = await VaultPaymentModel.find(
    { cloudKey: { $exists: true, $ne: null }, vaultAddress: { $exists: true, $ne: null } },
    { cloudKey: 1, vaultAddress: 1 },
  ).lean();
  for (const p of payments) {
    if (p.cloudKey && p.vaultAddress) cloudKeyToVault.set(p.cloudKey, p.vaultAddress);
  }
  console.log(`VaultPayment mappings: ${cloudKeyToVault.size}`);

  const users = await UserModel.find({}, { publicKey: 1, vaultAddress: 1 }).lean();
  let userFallbackAdded = 0;
  for (const u of users) {
    if (u.publicKey && u.vaultAddress && !cloudKeyToVault.has(u.publicKey)) {
      cloudKeyToVault.set(u.publicKey, u.vaultAddress);
      userFallbackAdded++;
    }
  }
  console.log(`User-table fallback added: ${userFallbackAdded}`);
  console.log(`Total cloudKey → vault mappings: ${cloudKeyToVault.size}`);

  // Find transactions missing userVaultAddress.
  const missing = await TransactionModel.find(
    { $or: [{ userVaultAddress: { $exists: false } }, { userVaultAddress: null }] },
    { _id: 1, walletAddress: 1 },
  ).lean();
  console.log(`Transactions missing userVaultAddress: ${missing.length}`);

  let updated = 0;
  const unmapped = new Map<string, number>();

  for (const tx of missing) {
    const vault = cloudKeyToVault.get(tx.walletAddress);
    if (!vault) {
      unmapped.set(tx.walletAddress, (unmapped.get(tx.walletAddress) ?? 0) + 1);
      continue;
    }
    await TransactionModel.updateOne({ _id: tx._id }, { $set: { userVaultAddress: vault } });
    updated++;
  }

  console.log(`\nDone. Updated ${updated} transactions.`);

  if (unmapped.size > 0) {
    console.log(`\nUnmapped walletAddress values (${unmapped.size}):`);
    for (const [key, count] of [...unmapped.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${key} — ${count} tx`);
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('backfillUserVaultAddress failed:', err);
  process.exit(1);
});
