import {
  createKeyPairFromBytes,
  getAddressFromPublicKey,
  getTransactionDecoder,
  getBase64Encoder,
  signTransaction,
  getBase64EncodedWireTransaction,
} from '@solana/kit';

import 'dotenv/config';

const API_BASE = 'http://localhost:3000';
const VAULT_ADDRESS = 'HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E';
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const devKey = process.env.DEV_PRIVATE_KEY;
if (!devKey) throw new Error('DEV_PRIVATE_KEY not set in .env');
const SECRET_KEY = new Uint8Array(JSON.parse(devKey));

async function main() {
  // 1. Create keypair
  const keypair = await createKeyPairFromBytes(SECRET_KEY);
  const pubkey = await getAddressFromPublicKey(keypair.publicKey);
  console.log('Keypair loaded:', pubkey);

  // 2. Fetch positions to get the amount
  console.log('Fetching positions...');
  const positionsRes = await fetch(`${API_BASE}/earn/v1/positions?walletAddress=${pubkey}`);
  const positionsData = await positionsRes.json();
  if (!positionsData.success) {
    console.error('Positions request failed:', positionsData);
    return;
  }

  const position = positionsData.data.find(
    (p: any) => p.type === 'kamino' && p.mint === MINT && p.vaultAddress === VAULT_ADDRESS,
  );
  if (!position) {
    console.error('No Kamino position found for vault:', VAULT_ADDRESS);
    return;
  }
  console.log(`Found position: ${position.balance.uiAmount} ${position.symbol} (${position.balance.amount} raw)`);

  // 3. Request unsigned withdraw transaction
  console.log('Requesting Kamino withdraw transaction...');
  const withdrawRes = await fetch(`${API_BASE}/earn/v1/withdraw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'kamino',
      mint: MINT,
      vaultAddress: VAULT_ADDRESS,
      amount: position.balance.amount,
      walletAddress: pubkey,
    }),
  });

  const withdrawData = await withdrawRes.json();
  if (!withdrawData.success) {
    console.error('Withdraw request failed:', withdrawData);
    return;
  }
  console.log('Got unsigned transaction');

  // 4. Decode, sign, re-encode
  const txBytes = getBase64Encoder().encode(withdrawData.transaction);
  const decoded = getTransactionDecoder().decode(txBytes);
  const signed = await signTransaction([keypair], decoded);
  const signedBase64 = getBase64EncodedWireTransaction(signed);
  console.log('Transaction signed');

  // 5. Send signed transaction
  console.log('Sending transaction...');
  const sendRes = await fetch(`${API_BASE}/solana/v1/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: signedBase64 }),
  });

  const sendData = await sendRes.json();
  console.log('Result:', sendData);
}

main().catch(console.error);
