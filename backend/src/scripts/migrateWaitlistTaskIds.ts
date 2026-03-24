import 'dotenv/config';
import mongoose from 'mongoose';
import { WaitlistTaskModel } from '../models/WaitlistTask';
import { WaitlistUserModel } from '../models/WaitlistUser';

const RENAMES: [string, string][] = [
  ['follow_cashflow_x', 'follow_x_cashflow_fi'],
  ['follow_heymike_x', 'follow_x_heymike777'],
  ['retweet_announcement', 'retweet_announcement_1'],
  ['subscribe_founders_tg', 'subscribe_tg_founders_journey'],
];

async function migrate() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');

  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  for (const [oldId, newId] of RENAMES) {
    // Rename in WaitlistTask collection
    const taskResult = await WaitlistTaskModel.updateOne(
      { taskId: oldId },
      { $set: { taskId: newId } },
    );
    console.log(`Task ${oldId} → ${newId}: ${taskResult.modifiedCount} updated`);

    // Rename in WaitlistUser.completedTasks arrays
    const userResult = await WaitlistUserModel.updateMany(
      { completedTasks: oldId },
      { $set: { 'completedTasks.$': newId } },
    );
    console.log(`  Users completedTasks: ${userResult.modifiedCount} updated`);

    // Rename in WaitlistTask.requiresTask references
    const reqResult = await WaitlistTaskModel.updateMany(
      { requiresTask: oldId },
      { $set: { requiresTask: newId } },
    );
    if (reqResult.modifiedCount > 0) {
      console.log(`  requiresTask refs: ${reqResult.modifiedCount} updated`);
    }
  }

  console.log('Migration complete');
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
