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
    user = await privy.users().search({ emails: [email], phoneNumbers: [], walletAddresses: [] });
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
  const user = await privy.users().search({ emails: [email], phoneNumbers: [], walletAddresses: [] });

  if (!user) {
    throw new Error('Privy user not found for this email');
  }

  // Find their Solana embedded wallet
  const solanaWallet = (user as any).linked_accounts?.find(
    (a: any) => a.type === 'wallet' && a.chain_type === 'solana'
  );

  if (!solanaWallet) {
    throw new Error('No Solana wallet found for this Privy user');
  }

  const walletId = solanaWallet.id;
  const walletAddress = solanaWallet.address;

  // Sign via Privy SDK
  try {
    const result = await privy.wallets().solana().signTransaction(walletId, {
      transaction: transactionBase64,
    });

    return {
      signature: result.signed_transaction,
      address: walletAddress,
    };
  } catch (err: any) {
    const detail = err?.message || 'Unknown error';
    throw new Error(`Privy signing failed: ${detail}`);
  }
}
