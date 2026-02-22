import * as ed from '@noble/ed25519';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { DEV_PRIVATE_KEY } from '@env';
import apiService from './apiService';

// TODO: replace with Mobile Wallet Adapter signing
const DEV_KEYPAIR_BYTES = new Uint8Array(JSON.parse(DEV_PRIVATE_KEY));

// First 32 bytes = private key seed, last 32 = public key
const SECRET_KEY = DEV_KEYPAIR_BYTES.slice(0, 32);
const PUBLIC_KEY = DEV_KEYPAIR_BYTES.slice(32);

let cachedAddress: string | null = null;

export async function getDevWalletAddress(): Promise<string> {
  if (!cachedAddress) {
    cachedAddress = bs58.encode(PUBLIC_KEY);
  }
  return cachedAddress;
}

// Read compact-u16 from wire format, returns [value, bytesConsumed]
function readCompactU16(data: Uint8Array, offset: number): [number, number] {
  let val = data[offset]!;
  if (val <= 0x7f) return [val, 1];
  val &= 0x7f;
  const next = data[offset + 1]!;
  val |= (next & 0x7f) << 7;
  if (next <= 0x7f) return [val, 2];
  val |= (data[offset + 2]! & 0x03) << 14;
  return [val, 3];
}

export async function signAndSendTransaction(
  unsignedBase64: string,
  transactionId: string,
): Promise<{ signature: string }> {
  const txBytes = Buffer.from(unsignedBase64, 'base64');

  // Parse wire format: compact-u16 numSignatures, then N * 64 bytes of signatures, then message
  const [numSignatures, compactLen] = readCompactU16(txBytes, 0);
  const messageOffset = compactLen + numSignatures * 64;
  const messageBytes = txBytes.slice(messageOffset);

  // Sign the message with ed25519
  const signature = await ed.signAsync(messageBytes, SECRET_KEY);

  // Write signature into the first slot (fee payer)
  const signedTx = Buffer.from(txBytes);
  signedTx.set(signature, compactLen);

  const signedBase64 = signedTx.toString('base64');
  const signatureBase58 = bs58.encode(signature);

  console.log('Transaction signed, signature:', signatureBase58);

  // Send to backend
  await apiService.sendTransaction(signedBase64, transactionId);

  return { signature: signatureBase58 };
}
