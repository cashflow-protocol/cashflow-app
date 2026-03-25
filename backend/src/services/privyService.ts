import { PrivyClient } from '@privy-io/node';

const PRIVY_APP_ID = process.env.PRIVY_APP_ID || '';
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET || '';

const privy = new PrivyClient({
  appId: PRIVY_APP_ID,
  appSecret: PRIVY_APP_SECRET,
});

/**
 * Create or retrieve a Privy user by email address.
 * Automatically creates an embedded Solana wallet.
 */
export async function getOrCreatePrivyUser(email: string): Promise<{
  privyUserId: string;
  solanaAddress: string | null;
}> {
  // Search for existing user by email
  let user;
  try {
    const searchResult = await privy.users().search({ emails: [email], phoneNumbers: [], walletAddresses: [] });
    user = (searchResult as any).data?.[0];
  } catch {}

  if (!user) {
    // Create user with email + Solana wallet
    user = await privy.users().create({
      linked_accounts: [
        { type: 'email', address: email },
      ],
      wallets: [{ chain_type: 'solana' }],
    });
  }

  // Find Solana wallet
  const solanaWallet = (user as any).linked_accounts?.find(
    (a: any) => a.type === 'wallet' && a.chain_type === 'solana'
  );

  if (solanaWallet) {
    return { privyUserId: (user as any).id, solanaAddress: solanaWallet.address };
  }

  // Create wallet if not found
  try {
    const wallet = await privy.wallets().create({ chain_type: 'solana' });
    return { privyUserId: (user as any).id, solanaAddress: wallet.address };
  } catch (err: any) {
    console.error('Failed to create Privy Solana wallet:', err.message);
    return { privyUserId: (user as any).id, solanaAddress: null };
  }
}

/**
 * Sign a Solana transaction using a Privy embedded wallet.
 * Uses the Privy Node SDK which handles authorization automatically.
 */
export async function signTransactionWithPrivy(
  email: string,
  transactionBase64: string,
): Promise<{ signature: string; address: string }> {
  // Find user by email
  const searchResult = await privy.users().search({ emails: [email], phoneNumbers: [], walletAddresses: [] });
  const user = (searchResult as any).data?.[0];

  if (!user) {
    throw new Error('Privy user not found for this email');
  }

  // Find their Solana embedded wallet
  const accounts = user.linked_accounts || [];
  const solanaWallet = accounts.find(
    (a: any) => a.type === 'wallet' && a.chain_type === 'solana'
  );

  if (!solanaWallet) {
    throw new Error('No Solana wallet found for this Privy user');
  }

  const walletId = solanaWallet.id;
  const walletAddress = solanaWallet.address;

  // Sign via Privy SDK with authorization key
  const authPrivateKey = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY;
  console.log('[Privy] walletId:', walletId, 'address:', walletAddress);
  console.log('[Privy] authPrivateKey present:', !!authPrivateKey, 'length:', authPrivateKey?.length);
  console.log('[Privy] authKeyId:', process.env.PRIVY_AUTHORIZATION_ID || 'not set');
  try {
    const result = await privy.wallets().solana().signTransaction(walletId, {
      transaction: transactionBase64,
      authorization_context: authPrivateKey
        ? { authorization_private_keys: [authPrivateKey] }
        : undefined,
    });

    return {
      signature: result.signed_transaction,
      address: walletAddress,
    };
  } catch (err: any) {
    const status = err?.status || err?.response?.status || '';
    const body = err?.body ? JSON.stringify(err.body) : err?.response?.data ? JSON.stringify(err.response.data) : '';
    const detail = `${status} ${body || err.message}`;
    throw new Error(`Privy signing failed: ${detail}`);
  }
}
