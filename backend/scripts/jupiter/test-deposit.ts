import {
  createKeyPairFromBytes,
  getAddressFromPublicKey,
  getTransactionDecoder,
  getBase64Encoder,
  signTransaction,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
} from '@solana/kit';
import { USDC_MINT } from '../../src/constants';

import 'dotenv/config';

const API_BASE = 'http://localhost:3000';

const devKey = process.env.DEV_PRIVATE_KEY;
if (!devKey) throw new Error('DEV_PRIVATE_KEY not set in .env');
const SECRET_KEY = new Uint8Array(JSON.parse(devKey));

async function main() {
  // 1. Create keypair
  const keypair = await createKeyPairFromBytes(SECRET_KEY);
  const pubkey = await getAddressFromPublicKey(keypair.publicKey);
  console.log('Keypair loaded:', pubkey);

  // 2. Request unsigned deposit transaction
  console.log('Requesting deposit transaction...');
  const depositRes = await fetch(`${API_BASE}/earn/v1/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'jupiter',
      mint: USDC_MINT,
      amount: '100000',
      walletAddress: pubkey,
    }),
  });

  const depositData = await depositRes.json();
  if (!depositData.success) {
    console.error('Deposit request failed:', depositData);
    return;
  }
  console.log('Got unsigned transaction, transactionId:', depositData.transactionId);

  // 3. Decode, sign, re-encode
  const txBytes = getBase64Encoder().encode(depositData.transaction);
  const decoded = getTransactionDecoder().decode(txBytes);
  const signed = await signTransaction([keypair], decoded);
  const signedBase64 = getBase64EncodedWireTransaction(signed);
  console.log('Transaction signed, signature:', getSignatureFromTransaction(signed));

  // 4. Send signed transaction
  console.log('Sending transaction...');
  const sendRes = await fetch(`${API_BASE}/solana/v1/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: signedBase64, transactionId: depositData.transactionId }),
  });

  const sendData = await sendRes.json();
  console.log('Result:', sendData);
}

main().catch(console.error);
