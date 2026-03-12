import { verifyAsync } from '@noble/ed25519';
import { API_CONFIG } from '../config/api';

// Extract raw 32-byte Ed25519 public key from SPKI base64 (skip 12-byte SPKI header)
const spkiBytes = Buffer.from(API_CONFIG.responseVerifyKey, 'base64');
const publicKey = new Uint8Array(spkiBytes.subarray(12));

/**
 * Verify that a backend response has not been tampered with.
 * Returns true if the signature is valid, false otherwise.
 */
export async function verifyResponseSignature(
  body: Record<string, any>,
): Promise<boolean> {
  const { responseSignature, ...rest } = body;
  if (!responseSignature) return false;

  const message = new Uint8Array(Buffer.from(JSON.stringify(rest), 'utf-8'));
  const signature = new Uint8Array(Buffer.from(responseSignature, 'base64'));

  return verifyAsync(signature, message, publicKey);
}
