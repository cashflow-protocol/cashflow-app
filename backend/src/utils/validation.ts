/**
 * Validate a Solana address (base58-encoded, 32-44 chars).
 * Does not require a full base58 decode — just checks format and length.
 */
const BASE58_CHARS = /^[1-9A-HJ-NP-Za-km-z]+$/;

export function isValidSolanaAddress(address: string): boolean {
  if (typeof address !== 'string') return false;
  if (address.length < 32 || address.length > 44) return false;
  return BASE58_CHARS.test(address);
}
