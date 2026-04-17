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

/** Returns true if a < b using numeric segment comparison (e.g. "1.3" < "1.11") */
export function isVersionOlder(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return true;
    if (na > nb) return false;
  }
  return false;
}
