import crypto from 'crypto';

interface StoredChallenge {
  publicKey: string;
  expiresAt: number;
}

const challenges = new Map<string, StoredChallenge>();

const CHALLENGE_TTL_MS = 60_000; // 60 seconds

/** Generate a random challenge nonce for the given public key. */
export function createChallenge(publicKey: string): { challenge: string; expiresAt: string } {
  const challenge = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;

  challenges.set(challenge, { publicKey, expiresAt });

  return { challenge, expiresAt: new Date(expiresAt).toISOString() };
}

/** Consume a challenge (single-use). Returns the associated publicKey if valid, null otherwise. */
export function consumeChallenge(challenge: string): string | null {
  const entry = challenges.get(challenge);
  if (!entry) return null;

  challenges.delete(challenge);

  if (Date.now() > entry.expiresAt) return null;

  return entry.publicKey;
}

// Cleanup expired challenges every 30s
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of challenges) {
    if (now > entry.expiresAt) {
      challenges.delete(key);
    }
  }
}, 30_000);
