import 'dotenv/config';
import mongoose from 'mongoose';
import { WaitlistTaskModel } from '../models/WaitlistTask';

const CONNECT_TASKS = [
  {
    title: 'Connect your wallet',
    xpReward: 100,
    sortOrder: 0,
    category: 'social_connect',
    metadata: { provider: 'wallet' },
  },
  {
    title: 'Connect your email',
    xpReward: 100,
    sortOrder: 1,
    category: 'social_connect',
    metadata: { provider: 'email' },
  },
  {
    title: 'Connect your X',
    xpReward: 100,
    sortOrder: 2,
    category: 'social_connect',
    metadata: { provider: 'x' },
  },
  {
    title: 'Connect your Discord',
    xpReward: 100,
    sortOrder: 3,
    category: 'social_connect',
    metadata: { provider: 'discord' },
  },
  {
    title: 'Connect your Telegram',
    xpReward: 100,
    sortOrder: 4,
    category: 'social_connect',
    metadata: { provider: 'telegram' },
  },
];

// Tasks that require a connect task to be completed first
const ACTION_TASKS = [
  {
    title: 'Follow @cashflow_fi on X',
    xpReward: 200,
    sortOrder: 5,
    category: 'social_action',
    requiresProvider: 'x',
    metadata: { handle: 'cashflow_fi', profileUrl: 'https://x.com/cashflow_fi' },
  },
  {
    title: 'Follow @heymike777 on X',
    xpReward: 200,
    sortOrder: 6,
    category: 'social_action',
    requiresProvider: 'x',
    metadata: { handle: 'heymike777', profileUrl: 'https://x.com/heymike777' },
  },
  {
    title: 'Retweet our announcement',
    xpReward: 50,
    sortOrder: 7,
    category: 'social_action',
    requiresProvider: 'x',
    metadata: { tweetUrl: 'https://x.com/cashflow_fi' },
  },
  {
    title: 'Subscribe @founders_journey on Telegram',
    xpReward: 200,
    sortOrder: 8,
    category: 'social_action',
    requiresProvider: 'telegram',
    metadata: { channel: '@founders_journey', channelUrl: 'https://t.me/founders_journey' },
  },
  {
    title: 'Rate us on dApp Store',
    xpReward: 300,
    sortOrder: 9,
    category: 'action',
    metadata: { storeUrl: 'https://cashflow.fun/download', requiresScreenshot: true },
  },
];

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');

  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  // Upsert connect tasks by category + provider (unique key)
  const providerToId = new Map<string, string>();
  for (const task of CONNECT_TASKS) {
    const result = await WaitlistTaskModel.findOneAndUpdate(
      { category: task.category, 'metadata.provider': task.metadata.provider },
      { $set: task },
      { upsert: true, returnDocument: 'after' },
    );
    providerToId.set(task.metadata.provider, result._id.toString());
    console.log(`  Upserted: ${task.title} (${result._id})`);
  }

  // Upsert action tasks, resolving requiresTask to _id
  for (const { requiresProvider, ...task } of ACTION_TASKS) {
    const requiresTask = requiresProvider ? providerToId.get(requiresProvider) : undefined;
    // Use title + category as upsert key for action tasks
    const result = await WaitlistTaskModel.findOneAndUpdate(
      { title: task.title, category: task.category },
      { $set: { ...task, requiresTask } },
      { upsert: true, returnDocument: 'after' },
    );
    console.log(`  Upserted: ${task.title} (${result._id})`);
  }

  console.log('Seed complete');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
