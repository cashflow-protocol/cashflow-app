import 'dotenv/config';
import mongoose from 'mongoose';
import { WaitlistTaskModel } from '../models/WaitlistTask';

const TASKS = [
  {
    taskId: 'connect_email',
    title: 'Connect your email',
    xpReward: 100,
    sortOrder: 0,
    category: 'social_connect',
  },
  {
    taskId: 'connect_x',
    title: 'Connect your X',
    xpReward: 100,
    sortOrder: 1,
    category: 'social_connect',
  },
  {
    taskId: 'connect_discord',
    title: 'Connect your Discord',
    xpReward: 100,
    sortOrder: 2,
    category: 'social_connect',
  },
  {
    taskId: 'connect_telegram',
    title: 'Connect your Telegram',
    xpReward: 100,
    sortOrder: 3,
    category: 'social_connect',
  },
  {
    taskId: 'follow_cashflow_x',
    title: 'Follow @cashflow_fi on X',
    xpReward: 200,
    sortOrder: 4,
    requiresTask: 'connect_x',
    category: 'social_action',
    metadata: { handle: '@cashflow_fi' },
  },
  {
    taskId: 'follow_heymike_x',
    title: 'Follow @heymike777 on X',
    xpReward: 200,
    sortOrder: 5,
    requiresTask: 'connect_x',
    category: 'social_action',
    metadata: { handle: '@heymike777' },
  },
  {
    taskId: 'retweet_announcement',
    title: 'Retweet our announcement',
    xpReward: 50,
    sortOrder: 6,
    requiresTask: 'connect_x',
    category: 'social_action',
  },
  {
    taskId: 'subscribe_founders_tg',
    title: 'Subscribe @founders_journey on Telegram',
    xpReward: 200,
    sortOrder: 7,
    requiresTask: 'connect_telegram',
    category: 'social_action',
    metadata: { channel: '@founders_journey' },
  },
];

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');

  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  for (const task of TASKS) {
    await WaitlistTaskModel.findOneAndUpdate(
      { taskId: task.taskId },
      { $set: task },
      { upsert: true },
    );
    console.log(`  Upserted task: ${task.taskId}`);
  }

  console.log('Seed complete');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
