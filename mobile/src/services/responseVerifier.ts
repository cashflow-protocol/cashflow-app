import { verifyAsync } from '@noble/ed25519';
import { API_CONFIG } from '../config/api';

// Extract raw 32-byte Ed25519 public key from SPKI base64 (skip 12-byte SPKI header)
const spkiBytes = Buffer.from(API_CONFIG.responseVerifyKey, 'base64');
const publicKey = new Uint8Array(spkiBytes.subarray(12));

/**
 * Verify that a backend response has not been tampered with.
 * Takes the raw response text and the base64 signature from the X-Response-Signature header.
 */
export async function verifyResponseSignature(
  rawText: string,
  signature: string | null,
): Promise<boolean> {
  if (!signature) return false;

  const message = new Uint8Array(Buffer.from(rawText, 'utf-8'));
  const sigBytes = new Uint8Array(Buffer.from(signature, 'base64'));

  return verifyAsync(sigBytes, message, publicKey);
}
