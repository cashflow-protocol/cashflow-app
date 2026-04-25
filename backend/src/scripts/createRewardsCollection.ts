import 'dotenv/config';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { keypairIdentity, generateSigner } from '@metaplex-foundation/umi';
import { mplCore, createCollection } from '@metaplex-foundation/mpl-core';
import { getAdminTxFeePayerKeypair } from '../services/adminFeePayer';

/**
 * Creates the single shared Metaplex Core Collection that owns all reward badges.
 * Run once per environment (devnet + mainnet). Idempotent — refuses to run if
 * REWARDS_COLLECTION_ADDRESS is already set in env.
 *
 * Usage: ts-node src/scripts/createRewardsCollection.ts
 */
async function main() {
  if (process.env.REWARDS_COLLECTION_ADDRESS) {
    console.log('REWARDS_COLLECTION_ADDRESS is already set — refusing to create another collection.');
    console.log(`  Current: ${process.env.REWARDS_COLLECTION_ADDRESS}`);
    console.log('  Unset the env var to create a new one.');
    process.exit(0);
  }

  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) throw new Error('SOLANA_RPC_URL is required');

  const collectionName = process.env.REWARDS_COLLECTION_NAME || 'Cashflow Rewards';
  const collectionUri = process.env.REWARDS_COLLECTION_URI;
  if (!collectionUri) {
    throw new Error('REWARDS_COLLECTION_URI is required (URL to the collection metadata JSON)');
  }

  const adminKeypair = getAdminTxFeePayerKeypair();

  const umi = createUmi(rpcUrl).use(mplCore());
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(adminKeypair.secretKey);
  umi.use(keypairIdentity(umiKeypair));

  const collectionSigner = generateSigner(umi);

  console.log(`Admin (collection authority): ${umiKeypair.publicKey.toString()}`);
  console.log(`Collection address (to be created): ${collectionSigner.publicKey.toString()}`);
  console.log(`Name: ${collectionName}`);
  console.log(`URI: ${collectionUri}`);
  console.log('Sending transaction…');

  const result = await createCollection(umi, {
    collection: collectionSigner,
    name: collectionName,
    uri: collectionUri,
    plugins: [],
  }).sendAndConfirm(umi);

  const sig = Buffer.from(result.signature).toString('base64');
  console.log('\nCreated successfully.');
  console.log(`  Signature (base64): ${sig}`);
  console.log(`  Collection address: ${collectionSigner.publicKey.toString()}`);
  console.log('\nSet this in your .env:');
  console.log(`  REWARDS_COLLECTION_ADDRESS=${collectionSigner.publicKey.toString()}`);
}

main().catch((err) => {
  console.error('Create collection failed:', err);
  process.exit(1);
});
