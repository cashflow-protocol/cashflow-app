import 'dotenv/config';
import mongoose from 'mongoose';
import { WaitlistTaskModel } from '../models/WaitlistTask';
import { WaitlistUserModel } from '../models/WaitlistUser';

/**
 * Migration: Remove taskId field, switch completedTasks and requiresTask to use _id.
 *
 * 1. For each task that still has a taskId, build a mapping: oldTaskId → _id
 * 2. Update all WaitlistUser.completedTasks entries from oldTaskId to _id
 * 3. Update all WaitlistTask.requiresTask entries from oldTaskId to _id
 * 4. Remove taskId field from all tasks
 * 5. Add metadata.provider for social_connect tasks that don't have it
 * 6. Drop the unique taskId index
 */
async function migrate() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');

  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  // Step 1: Build taskId → _id mapping
  const tasks = await WaitlistTaskModel.find().lean();
  const taskIdToObjectId = new Map<string, string>();
  for (const t of tasks) {
    const oldTaskId = (t as any).taskId;
    if (oldTaskId) {
      taskIdToObjectId.set(oldTaskId, t._id.toString());
    }
  }
  console.log(`Found ${taskIdToObjectId.size} tasks with taskId field`);

  if (taskIdToObjectId.size === 0) {
    console.log('No tasks with taskId found — migration may have already run');
    await mongoose.disconnect();
    return;
  }

  // Step 2: Update completedTasks on all users
  const users = await WaitlistUserModel.find({ completedTasks: { $exists: true, $ne: [] } });
  let usersUpdated = 0;
  for (const user of users) {
    const updated = user.completedTasks.map((id) => taskIdToObjectId.get(id) || id);
    if (JSON.stringify(updated) !== JSON.stringify(user.completedTasks)) {
      user.completedTasks = updated;
      await user.save();
      usersUpdated++;
    }
  }
  console.log(`Updated completedTasks for ${usersUpdated} users`);

  // Step 3: Update requiresTask on tasks
  for (const t of tasks) {
    const oldReq = t.requiresTask;
    if (oldReq && taskIdToObjectId.has(oldReq)) {
      await WaitlistTaskModel.findByIdAndUpdate(t._id, {
        $set: { requiresTask: taskIdToObjectId.get(oldReq) },
      });
      console.log(`  Updated requiresTask for "${(t as any).taskId}": ${oldReq} → ${taskIdToObjectId.get(oldReq)}`);
    }
  }

  // Step 4: Add metadata.provider for social_connect tasks
  const providerMap: Record<string, string> = {
    connect_wallet: 'wallet',
    connect_email: 'email',
    connect_x: 'x',
    connect_discord: 'discord',
    connect_telegram: 'telegram',
  };
  for (const [oldId, provider] of Object.entries(providerMap)) {
    const objectId = taskIdToObjectId.get(oldId);
    if (objectId) {
      await WaitlistTaskModel.findByIdAndUpdate(objectId, {
        $set: { 'metadata.provider': provider },
      });
      console.log(`  Set metadata.provider="${provider}" for ${oldId}`);
    }
  }

  // Step 5: Drop the unique taskId index first (must happen before unsetting field)
  const db = mongoose.connection.db!;
  try {
    await db.collection('waitlist_tasks').dropIndex('taskId_1');
    console.log('Dropped taskId_1 index');
  } catch (err: any) {
    if (err.codeName === 'IndexNotFound') {
      console.log('taskId_1 index already removed');
    } else {
      throw err;
    }
  }

  // Step 6: Remove taskId field from all tasks
  const result = await db.collection('waitlist_tasks').updateMany(
    {},
    { $unset: { taskId: '' } },
  );
  console.log(`Removed taskId field from ${result.modifiedCount} tasks`);

  // Step 7: Update proofScreenshots taskId references
  const usersWithScreenshots = await WaitlistUserModel.find({ 'proofScreenshots.0': { $exists: true } });
  let screenshotsUpdated = 0;
  for (const user of usersWithScreenshots) {
    let changed = false;
    for (const ss of user.proofScreenshots) {
      const mapped = taskIdToObjectId.get(ss.taskId);
      if (mapped) {
        ss.taskId = mapped;
        changed = true;
      }
    }
    if (changed) {
      await user.save();
      screenshotsUpdated++;
    }
  }
  console.log(`Updated proofScreenshots for ${screenshotsUpdated} users`);

  console.log('Migration complete');
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
