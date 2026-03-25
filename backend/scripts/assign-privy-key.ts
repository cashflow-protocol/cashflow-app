/**
 * One-time script to assign the authorization key to an existing Privy wallet.
 *
 * Usage: npx ts-node scripts/assign-privy-key.ts <wallet_id>
 * Example: npx ts-node scripts/assign-privy-key.ts qvdb4aniki746msbxj6fdf70
 */
import 'dotenv/config';

const PRIVY_APP_ID = process.env.PRIVY_APP_ID || '';
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET || '';
const AUTH_KEY_ID = process.env.PRIVY_AUTHORIZATION_ID || '';

async function main() {
  const walletId = process.argv[2];
  if (!walletId) {
    console.error('Usage: npx ts-node scripts/assign-privy-key.ts <wallet_id>');
    process.exit(1);
  }

  console.log('App ID:', PRIVY_APP_ID);
  console.log('Wallet ID:', walletId);
  console.log('Auth Key ID:', AUTH_KEY_ID);

  const credentials = Buffer.from(`${PRIVY_APP_ID}:${PRIVY_APP_SECRET}`).toString('base64');

  // Try PATCH to update wallet owner via raw API
  const res = await fetch(`https://api.privy.io/v1/wallets/${walletId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'privy-app-id': PRIVY_APP_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      owner_id: AUTH_KEY_ID,
    }),
  });

  const body = await res.json();
  console.log('Status:', res.status);
  console.log('Response:', JSON.stringify(body, null, 2));
}

main();
