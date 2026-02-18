import 'dotenv/config';
import mongoose from 'mongoose';
import { EarnTokenModel } from '../models';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cashflow';

async function migrate() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const result = await EarnTokenModel.updateMany(
    { status: { $exists: false } },
    { $set: { status: 'inactive' } }
  );

  console.log(`✅ Migration complete: ${result.modifiedCount} tokens set to inactive`);

  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
