import { PrivyClient } from '@privy-io/node';

const PRIVY_APP_ID = process.env.PRIVY_APP_ID || '';
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET || '';
const AUTH_KEY_ID = process.env.PRIVY_AUTHORIZATION_ID || '';
const AUTH_PRIVATE_KEY = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY || '';

const privy = new PrivyClient({
  appId: PRIVY_APP_ID,
  appSecret: PRIVY_APP_SECRET,
});

const authContext = AUTH_PRIVATE_KEY
  ? { authorization_private_keys: [AUTH_PRIVATE_KEY] }
  : undefined;

/**
 * Create a server-owned Privy Solana wallet for a recovery email.
 * The wallet is owned by our authorization key, so we can sign server-side.
 */
export async function createRecoveryWallet(email: string): Promise<{
  walletId: string;
  solanaAddress: string;
}> {
  // Create a server-owned wallet with our auth key as owner
  const wallet = await privy.wallets().create({
    chain_type: 'solana',
    owner_id: AUTH_KEY_ID,
  });

  console.log(`[Privy] Created server-owned wallet: ${wallet.address} (id: ${wallet.id}) for ${email}`);

  return {
    walletId: wallet.id,
    solanaAddress: wallet.address,
  };
}

/**
 * Sign a Solana transaction using a server-owned Privy wallet.
 * Looks up the wallet by address and signs with our authorization key.
 */
export async function signTransactionWithPrivy(
  walletAddress: string,
  transactionBase64: string,
): Promise<{ signedTransaction: string; address: string }> {
  if (!AUTH_PRIVATE_KEY) {
    throw new Error('PRIVY_AUTHORIZATION_PRIVATE_KEY not configured');
  }

  // Find the wallet by address
  const wallets = await privy.wallets().list({ chain_type: 'solana' });
  let walletId: string | null = null;

  for await (const wallet of wallets) {
    if (wallet.address === walletAddress) {
      walletId = wallet.id;
      break;
    }
  }

  if (!walletId) {
    throw new Error(`Privy wallet not found for address ${walletAddress}`);
  }

  console.log(`[Privy] Signing with wallet ${walletId} (${walletAddress})`);

  const result = await privy.wallets().solana().signTransaction(walletId, {
    transaction: transactionBase64,
    authorization_context: authContext,
  });

  return {
    signedTransaction: result.signed_transaction,
    address: walletAddress,
  };
}

/**
 * Look up Privy wallet emails by their Solana addresses.
 * Searches users who have wallets matching the given addresses.
 */
export async function lookupPrivyEmails(addresses: string[]): Promise<Record<string, string>> {
  const emails: Record<string, string> = {};

  for (const addr of addresses) {
    try {
      const user = await privy.users().search({
        emails: [],
        phoneNumbers: [],
        walletAddresses: [addr],
      });
      const userData = (user as any).data?.[0];
      if (userData) {
        const emailAccount = userData.linked_accounts?.find((a: any) => a.type === 'email');
        if (emailAccount?.address) {
          emails[addr] = emailAccount.address;
        }
      }
    } catch {}
  }

  return emails;
}
