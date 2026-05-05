import 'dotenv/config';
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cashflow';

async function backfill() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db!;
  const transactions = db.collection('transactions');
  const costBasis = db.collection('user_cost_basis');

  // Ensure unique index exists
  await costBasis.createIndex({ walletAddress: 1, mint: 1 }, { unique: true });

  // Aggregate all confirmed deposit/withdraw transactions by walletAddress + mint
  const aggregation = await transactions.aggregate([
    {
      $match: {
        status: 'confirmed',
        action: { $in: ['deposit', 'withdraw'] },
      },
    },
    {
      $group: {
        _id: { walletAddress: '$walletAddress', mint: '$mint' },
        deposits: {
          $push: {
            $cond: [{ $eq: ['$action', 'deposit'] }, '$amount', null],
          },
        },
        withdrawals: {
          $push: {
            $cond: [{ $eq: ['$action', 'withdraw'] }, '$amount', null],
          },
        },
      },
    },
  ]).toArray();

  console.log(`Found ${aggregation.length} wallet+mint combinations to backfill\n`);

  let count = 0;
  for (const record of aggregation) {
    const { walletAddress, mint } = record._id;

    const totalDeposited = record.deposits
      .filter((a: string | null) => a !== null)
      .reduce((sum: bigint, a: string) => sum + BigInt(a), 0n);

    const totalWithdrawn = record.withdrawals
      .filter((a: string | null) => a !== null)
      .reduce((sum: bigint, a: string) => sum + BigInt(a), 0n);

    await costBasis.updateOne(
      { walletAddress, mint },
      {
        $set: {
          totalDeposited: totalDeposited.toString(),
          totalWithdrawn: totalWithdrawn.toString(),
        },
        $setOnInsert: { createdAt: new Date() },
        $currentDate: { updatedAt: true },
      },
      { upsert: true },
    );

    count++;
    console.log(
      `  ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)} | ${mint.slice(0, 6)}... | deposited=${totalDeposited} withdrawn=${totalWithdrawn}`,
    );
  }

  console.log(`\nBackfill complete: ${count} records created/updated`);
  await mongoose.disconnect();
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
