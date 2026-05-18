import 'dotenv/config';
import mongoose from 'mongoose';
import { UserRewardProgressModel, RewardProgressStatus } from '../models/UserRewardProgress';

/**
 * One-shot: flip every UserRewardProgress with status=MINTED back to
 * IN_PROGRESS so the new "attributes on Cashflow Passport" flow can re-credit
 * the badge as an attribute (the verifier re-evaluates on next read,
 * and once the user activates their Cashflow Passport, the auto-add fires).
 *
 * Old standalone MintedBadge NFTs can't be burned —
 * they remain in user wallets as orphan records.
 */
async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI must be set');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const result = await UserRewardProgressModel.updateMany(
    { status: { $in: [RewardProgressStatus.MINTED, RewardProgressStatus.MINT_PENDING] } },
    {
      $set: {
        status: RewardProgressStatus.IN_PROGRESS,
        // Force verifier re-eval on next read.
        lastEvaluatedAt: undefined,
      },
      $unset: { lastEvaluatedAt: '', completedAt: '' },
    },
  );
  console.log(`Reset ${result.modifiedCount} progress rows to IN_PROGRESS.`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('resetMintedBadgesForReissue failed:', err);
  process.exit(1);
});
