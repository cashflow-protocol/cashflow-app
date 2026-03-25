/**
 * One-time script to assign the authorization key to an existing Privy wallet.
 *
 * Usage: npx ts-node scripts/assign-privy-key.ts <wallet_id>
 * Example: npx ts-node scripts/assign-privy-key.ts qvdb4aniki746msbxj6fdf70
 */
import 'dotenv/config';
import { PrivyClient } from '@privy-io/node';

const PRIVY_APP_ID = process.env.PRIVY_APP_ID || '';
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET || '';
const AUTH_KEY_ID = process.env.PRIVY_AUTHORIZATION_ID || '';

async function main() {
  const walletId = process.argv[2];
  if (!walletId) {
    console.error('Usage: npx ts-node scripts/assign-privy-key.ts <wallet_id>');
    process.exit(1);
  }

  if (!AUTH_KEY_ID) {
    console.error('PRIVY_AUTHORIZATION_ID not set in .env');
    process.exit(1);
  }

  console.log('App ID:', PRIVY_APP_ID);
  console.log('Wallet ID:', walletId);
  console.log('Auth Key ID:', AUTH_KEY_ID);

  const privy = new PrivyClient({
    appId: PRIVY_APP_ID,
    appSecret: PRIVY_APP_SECRET,
  });

  try {
    const result = await privy.wallets().update(walletId, {
      owner_id: AUTH_KEY_ID,
    });
    console.log('Wallet updated:', JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.error('Failed:', err.message);
    if (err.body) console.error('Body:', JSON.stringify(err.body));
  }
}

main();
