import 'dotenv/config';
import mongoose from 'mongoose';
import { RewardTaskModel, RewardVerifierType } from '../models/RewardTask';

interface SeedTask {
  slug: string;
  title: string;
  description: string;
  imageUrl: string;
  metadataUri: string;
  active?: boolean;
  sortOrder: number;
  mintFeeLamports?: string;
  maxSupply?: number;
  verifierType: RewardVerifierType;
  verifierConfig?: Record<string, any>;
}

const ASSET_BASE = process.env.REWARDS_ASSET_BASE_URL || 'https://cashflowfi.ams3.cdn.digitaloceanspaces.com/rewards';

const TASKS: SeedTask[] = [
  {
    slug: 'seeker-pioneer',
    title: 'Seeker Pioneer',
    description: 'Use Cashflow on a Solana Seeker device.',
    imageUrl: `${ASSET_BASE}/badges/seeker-pioneer.png`,
    metadataUri: `${ASSET_BASE}/metadata/seeker-pioneer.json`,
    sortOrder: 0,
    maxSupply: 10000,
    verifierType: RewardVerifierType.DEVICE_SEEKER,
    verifierConfig: {},
  },
  {
    slug: 'jupiter-lender-1k',
    title: 'Jupiter Lender',
    description: 'Deposit a cumulative $1,000 into Jupiter Lend.',
    imageUrl: `${ASSET_BASE}/badges/jupiter-lender-1k.png`,
    metadataUri: `${ASSET_BASE}/metadata/jupiter-lender-1k.json`,
    sortOrder: 10,
    verifierType: RewardVerifierType.ONCHAIN_DEPOSIT,
    verifierConfig: { protocol: 'jupiter', minUsd: 1000 },
  },
  {
    slug: 'kamino-lender-1k',
    title: 'Kamino Lender',
    description: 'Deposit a cumulative $1,000 into Kamino.',
    imageUrl: `${ASSET_BASE}/badges/kamino-lender-1k.png`,
    metadataUri: `${ASSET_BASE}/metadata/kamino-lender-1k.json`,
    sortOrder: 11,
    verifierType: RewardVerifierType.ONCHAIN_DEPOSIT,
    verifierConfig: { protocol: 'kamino', minUsd: 1000 },
  },
  {
    slug: 'swapper-1k',
    title: 'Swapper',
    description: 'Make $1,000 in cumulative swap volume.',
    imageUrl: `${ASSET_BASE}/badges/swapper-1k.png`,
    metadataUri: `${ASSET_BASE}/metadata/swapper-1k.json`,
    sortOrder: 20,
    verifierType: RewardVerifierType.ONCHAIN_SWAP_VOLUME,
    verifierConfig: { minUsd: 1000 },
  },
  {
    slug: 'first-payment',
    title: 'First Payment',
    description: 'Send your first transfer using Cashflow.',
    imageUrl: `${ASSET_BASE}/badges/first-payment.png`,
    metadataUri: `${ASSET_BASE}/metadata/first-payment.json`,
    sortOrder: 30,
    verifierType: RewardVerifierType.ONCHAIN_TRANSFER_OUT,
    verifierConfig: { minCount: 1 },
  },
];

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');

  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  for (const task of TASKS) {
    const result = await RewardTaskModel.findOneAndUpdate(
      { slug: task.slug },
      {
        $set: {
          title: task.title,
          description: task.description,
          imageUrl: task.imageUrl,
          metadataUri: task.metadataUri,
          active: task.active !== false,
          sortOrder: task.sortOrder,
          mintFeeLamports: task.mintFeeLamports ?? '20000000',
          maxSupply: task.maxSupply,
          verifierType: task.verifierType,
          verifierConfig: task.verifierConfig ?? {},
        },
        $setOnInsert: { slug: task.slug, mintedCount: 0 },
      },
      { upsert: true, new: true },
    );
    console.log(`  Upserted: ${task.slug} (${result._id})`);
  }

  console.log('Seed complete');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
