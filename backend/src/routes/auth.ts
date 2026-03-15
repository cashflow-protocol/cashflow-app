import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { getBase58Encoder } from '@solana/kit';
import { createChallenge, consumeChallenge } from '../services/challengeStore';
import { UserModel, AuthLogModel, WaitlistUserModel } from '../models';

const router = Router();

const TOKEN_EXPIRY_SECONDS = 86_400; // 24 hours

/** Validate that a string is a valid base58-encoded 32-byte Solana public key. */
function isValidPublicKey(value: string): boolean {
  try {
    const bytes = getBase58Encoder().encode(value);
    return bytes.length === 32;
  } catch {
    return false;
  }
}

/**
 * POST /challenge
 * Request a challenge nonce to prove ownership of a public key.
 */
router.post('/challenge', (req, res) => {
  const { publicKey } = req.body;

  if (!publicKey || typeof publicKey !== 'string') {
    res.status(400).json({ success: false, error: 'publicKey is required' });
    return;
  }

  if (!isValidPublicKey(publicKey)) {
    res.status(400).json({ success: false, error: 'Invalid public key' });
    return;
  }

  const result = createChallenge(publicKey);
  res.json({ success: true, ...result });
});

/**
 * POST /verify
 * Verify a signed challenge and issue a JWT access token.
 */
router.post('/verify', async (req, res) => {
  try {
    const { publicKey, challenge, signature, vaultAddress, inviteCode, appVersion, buildNumber, osVersion, device, platform } = req.body;

    if (!publicKey || !challenge || !signature || !vaultAddress) {
      res.status(400).json({ success: false, error: 'publicKey, challenge, signature, and vaultAddress are required' });
      return;
    }

    // Consume the challenge (single-use)
    const expectedPublicKey = consumeChallenge(challenge);
    if (!expectedPublicKey) {
      res.status(401).json({ success: false, error: 'Invalid or expired challenge' });
      return;
    }

    if (expectedPublicKey !== publicKey) {
      res.status(401).json({ success: false, error: 'Public key does not match challenge' });
      return;
    }

    // Decode the public key from base58 to raw bytes
    const publicKeyBytes = new Uint8Array(getBase58Encoder().encode(publicKey));

    // Import as Ed25519 CryptoKey
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );

    // Decode signature from base64
    const signatureBytes = Buffer.from(signature, 'base64');

    // The challenge string as UTF-8 bytes is what was signed
    const challengeBytes = new TextEncoder().encode(challenge);

    // Verify the Ed25519 signature
    const valid = await crypto.subtle.verify('Ed25519', cryptoKey, signatureBytes, challengeBytes);

    if (!valid) {
      res.status(401).json({ success: false, error: 'Invalid signature' });
      return;
    }

    // Upsert user and log auth event (non-blocking)
    const now = new Date();
    (async () => {
      try {
        // Look up waitlist user to link
        const waitlistUser = await WaitlistUserModel.findOne({ publicKey }).lean();
        const extraFields: Record<string, any> = { lastSeenAt: now, publicKey };
        if (inviteCode) extraFields.inviteCode = inviteCode;
        if (waitlistUser) extraFields.waitlistUserId = String(waitlistUser._id);

        await UserModel.findOneAndUpdate(
          { vaultAddress },
          { $set: extraFields, $setOnInsert: { vaultAddress } },
          { upsert: true },
        );
      } catch (err) {
        console.error('User upsert error:', err);
      }
    })();

    AuthLogModel.create({
      publicKey,
      appVersion,
      buildNumber,
      osVersion,
      device,
      platform,
      ipAddress: req.ip,
    }).catch((err) => console.error('AuthLog create error:', err));

    // Issue JWT
    const accessToken = jwt.sign(
      { sub: publicKey, vaultAddress },
      process.env.JWT_SECRET!,
      { expiresIn: TOKEN_EXPIRY_SECONDS },
    );

    res.json({
      success: true,
      accessToken,
      expiresIn: TOKEN_EXPIRY_SECONDS,
    });
  } catch (error) {
    console.error('Auth verify error:', error);
    res.status(500).json({ success: false, error: 'Authentication failed' });
  }
});

export default router;
