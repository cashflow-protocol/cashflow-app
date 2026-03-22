import axios from 'axios';

const PRIVY_APP_ID = process.env.PRIVY_APP_ID || '';
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET || '';
const PRIVY_BASE_URL = 'https://auth.privy.io/api/v1';

function getHeaders() {
  const credentials = Buffer.from(`${PRIVY_APP_ID}:${PRIVY_APP_SECRET}`).toString('base64');
  return {
    'Authorization': `Basic ${credentials}`,
    'privy-app-id': PRIVY_APP_ID,
    'Content-Type': 'application/json',
  };
}

/**
 * Create or retrieve a Privy user by email address.
 * If the user already exists, returns the existing user.
 * Automatically creates an embedded Solana wallet.
 */
export async function getOrCreatePrivyUser(email: string): Promise<{
  privyUserId: string;
  solanaAddress: string | null;
}> {
  const headers = getHeaders();

  // Try to find existing user by email
  let userId: string | null = null;

  try {
    const searchRes = await axios.post(`${PRIVY_BASE_URL}/users/search`, {
      query: { email },
    }, { headers });

    if (searchRes.data?.data?.length > 0) {
      userId = searchRes.data.data[0].id;
    }
  } catch {
    // User doesn't exist yet
  }

  // Create user if not found
  if (!userId) {
    const createRes = await axios.post(`${PRIVY_BASE_URL}/users`, {
      linked_accounts: [
        { type: 'email', address: email },
      ],
      create_solana_wallet: true,
    }, { headers });

    userId = createRes.data.id;

    // The wallet may be in the create response
    const wallets = createRes.data.linked_accounts?.filter(
      (a: any) => a.type === 'wallet' && a.chain_type === 'solana'
    );
    if (wallets?.length > 0) {
      return { privyUserId: userId!, solanaAddress: wallets[0].address };
    }
  }

  // Fetch user to get wallet
  const userRes = await axios.get(`${PRIVY_BASE_URL}/users/${userId}`, { headers });
  const solanaWallets = userRes.data.linked_accounts?.filter(
    (a: any) => a.type === 'wallet' && a.chain_type === 'solana'
  );

  // If no Solana wallet yet, create one
  if (!solanaWallets || solanaWallets.length === 0) {
    try {
      const walletRes = await axios.post(`${PRIVY_BASE_URL}/users/${userId}/wallets`, {
        chain_type: 'solana',
      }, { headers });

      return { privyUserId: userId!, solanaAddress: walletRes.data.address || null };
    } catch (err: any) {
      console.error('Failed to create Privy Solana wallet:', err?.response?.data || err.message);
      return { privyUserId: userId!, solanaAddress: null };
    }
  }

  return { privyUserId: userId!, solanaAddress: solanaWallets[0].address };
}

/**
 * Sign a Solana transaction message using a Privy embedded wallet.
 * Looks up the user by email, finds their Solana wallet, and signs via Privy API.
 *
 * @param email The email address of the Privy user
 * @param transactionBase64 Base64-encoded serialized transaction (VersionedTransaction)
 * @returns Base64-encoded signature (64 bytes)
 */
export async function signTransactionWithPrivy(
  email: string,
  transactionBase64: string,
): Promise<{ signature: string; address: string }> {
  const headers = getHeaders();

  // Find user by email
  const searchRes = await axios.post(`${PRIVY_BASE_URL}/users/search`, {
    query: { email },
  }, { headers });

  if (!searchRes.data?.data?.length) {
    throw new Error('Privy user not found for this email');
  }

  const user = searchRes.data.data[0];
  const userId = user.id;

  // Find their Solana embedded wallet
  const solanaWallets = user.linked_accounts?.filter(
    (a: any) => a.type === 'wallet' && a.chain_type === 'solana'
  );

  if (!solanaWallets?.length) {
    throw new Error('No Solana wallet found for this Privy user');
  }

  const walletId = solanaWallets[0].id;
  const walletAddress = solanaWallets[0].address;

  // Sign transaction via Privy wallet RPC
  let signRes;
  try {
    signRes = await axios.post(
      `${PRIVY_BASE_URL}/wallets/${walletId}/rpc`,
      {
        method: 'signTransaction',
        params: {
          transaction: transactionBase64,
          encoding: 'base64',
        },
      },
      { headers: { ...headers, 'privy-authorization-signature': userId } },
    );
  } catch (err: any) {
    const detail = err?.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`Privy signing failed: ${detail}`);
  }

  if (!signRes.data?.data?.signature) {
    throw new Error('Privy signing failed — no signature returned');
  }

  return {
    signature: signRes.data.data.signature,
    address: walletAddress,
  };
}
