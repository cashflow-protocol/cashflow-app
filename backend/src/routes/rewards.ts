import { Router, Response } from 'express';
import { getBase58Encoder } from '@solana/kit';
import type { AuthenticatedRequest } from '../middleware/auth';
import { rewardManager } from '../managers/RewardManager';
import { UserModel } from '../models/User';
import { isValidSolanaAddress } from '../utils/validation';
import { createChallenge, consumeChallenge } from '../services/challengeStore';
import {
  buildActivation,
  recordAndConfirmActivation,
  InsufficientBalanceError,
} from '../services/cashflowPassportService';
import {
  buildBadgeMint,
  recordAndConfirmBadgeMint,
  PassportNotActivatedError,
  TaskNotClaimableError,
  TaskSoldOutError,
  TaskInactiveError,
} from '../services/badgeMintService';
import { getCashflowPassportActivationFeeLamports } from '../managers/RewardMintBuilder';

const router = Router();

/**
 * GET /rewards/v2/tasks
 * Returns the active reward catalog with progress for the caller's vault.
 */
router.get('/tasks', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vaultAddress = req.user?.vaultAddress;
    if (!vaultAddress) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }
    const [tasks, user] = await Promise.all([
      rewardManager.getTasksForVault(vaultAddress),
      UserModel.findOne({ vaultAddress }, { cashflowPassportAddress: 1, cashflowPassportActivatedAt: 1 }).lean(),
    ]);
    res.json({
      success: true,
      data: {
        tasks,
        cashflowPassport: {
          address: user?.cashflowPassportAddress ?? null,
          activated: !!user?.cashflowPassportAddress,
          activatedAt: user?.cashflowPassportActivatedAt ?? null,
          feeLamports: getCashflowPassportActivationFeeLamports().toString(),
        },
      },
    });
  } catch (err) {
    console.error('GET /rewards/v2/tasks error:', err);
    res.status(500).json({ success: false, error: 'Failed to load rewards' });
  }
});

/**
 * GET /rewards/v2/attest-seeker/challenge?walletAddress=...
 * Issues a one-time nonce for the caller to sign with their MWA wallet.
 */
router.get('/attest-seeker/challenge', (req: AuthenticatedRequest, res: Response) => {
  const vaultAddress = req.user?.vaultAddress;
  if (!vaultAddress) {
    res.status(401).json({ success: false, error: 'Not authenticated' });
    return;
  }
  const { walletAddress } = req.query;
  if (typeof walletAddress !== 'string' || !isValidSolanaAddress(walletAddress)) {
    res.status(400).json({ success: false, error: 'walletAddress query parameter is required' });
    return;
  }
  const result = createChallenge(walletAddress);
  res.json({ success: true, ...result });
});

/**
 * POST /rewards/v2/attest-seeker
 * Body: { walletAddress, challenge, signature (base64) }
 * Verifies the wallet signature over the previously-issued challenge,
 * then sets User.seekerAttestedAt for the caller's vault.
 */
router.post('/attest-seeker', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vaultAddress = req.user?.vaultAddress;
    if (!vaultAddress) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }
    const { walletAddress, challenge, signature } = req.body ?? {};
    if (!walletAddress || !challenge || !signature) {
      res.status(400).json({ success: false, error: 'walletAddress, challenge, and signature are required' });
      return;
    }
    if (!isValidSolanaAddress(walletAddress)) {
      res.status(400).json({ success: false, error: 'Invalid walletAddress' });
      return;
    }

    const expectedWallet = consumeChallenge(challenge);
    if (!expectedWallet || expectedWallet !== walletAddress) {
      res.status(401).json({ success: false, error: 'Invalid or expired challenge' });
      return;
    }

    const publicKeyBytes = new Uint8Array(getBase58Encoder().encode(walletAddress));
    if (publicKeyBytes.length !== 32) {
      res.status(400).json({ success: false, error: 'Invalid public key length' });
      return;
    }
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const signatureBytes = Buffer.from(signature, 'base64');
    const challengeBytes = new TextEncoder().encode(challenge);
    const valid = await crypto.subtle.verify('Ed25519', cryptoKey, signatureBytes, challengeBytes);
    if (!valid) {
      res.status(401).json({ success: false, error: 'Invalid signature' });
      return;
    }

    await UserModel.updateOne(
      { vaultAddress },
      { $set: { seekerAttestedAt: new Date() } },
    );
    res.json({ success: true });
  } catch (err) {
    console.error('POST /rewards/v2/attest-seeker error:', err);
    res.status(500).json({ success: false, error: 'Attestation failed' });
  }
});

/**
 * POST /rewards/v2/cashflow-passport/activate
 * Builds the one-time Cashflow Passport mint transaction. Returns a fee transfer
 * (vault → treasury) as inner instructions plus an admin-pre-signed Metaplex
 * Core mint TX. Mobile bundles them via executeVaultTransaction (TX1-TX4 + TX5).
 */
router.post('/cashflow-passport/activate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vaultAddress = req.user?.vaultAddress;
    if (!vaultAddress) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }

    const user = await UserModel.findOne({ vaultAddress }, { cashflowPassportAddress: 1 }).lean();
    if (user?.cashflowPassportAddress) {
      res.status(409).json({ success: false, error: 'Cashflow Passport already activated' });
      return;
    }

    const built = await buildActivation(vaultAddress);
    res.json({ success: true, data: built });
  } catch (err: any) {
    if (err instanceof InsufficientBalanceError) {
      res.status(400).json({
        success: false,
        error: err.message,
        errorCode: 'INSUFFICIENT_BALANCE',
        requiredLamports: err.required.toString(),
        availableLamports: err.available.toString(),
      });
      return;
    }
    console.error('POST /rewards/v2/cashflow-passport/activate error:', err);
    res.status(500).json({ success: false, error: err?.message ?? 'Failed to build activation' });
  }
});

/**
 * POST /rewards/v2/cashflow-passport/activate/confirm
 * Body: { activationId, bundleSignatures: string[] }
 * Mobile calls this after submitting the bundle. We verify onchain
 * synchronously; the recovery cron is the failsafe for slow confirms.
 */
router.post('/cashflow-passport/activate/confirm', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vaultAddress = req.user?.vaultAddress;
    if (!vaultAddress) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }
    const { activationId, bundleSignatures } = req.body ?? {};
    if (!activationId || !Array.isArray(bundleSignatures)) {
      res.status(400).json({ success: false, error: 'activationId and bundleSignatures are required' });
      return;
    }

    const outcome = await recordAndConfirmActivation(activationId, vaultAddress, bundleSignatures);
    res.json({ success: true, status: outcome });
  } catch (err: any) {
    console.error('POST /rewards/v2/cashflow-passport/activate/confirm error:', err);
    const status = err?.message === 'Activation not found' ? 404 : 500;
    res.status(status).json({ success: false, error: err?.message ?? 'Failed to confirm activation' });
  }
});

/**
 * POST /rewards/v2/badge/mint
 * Body: { taskSlug }
 * Builds an admin-pre-signed Metaplex Core updatePlugin TX for the badge,
 * plus inner instructions (vault → admin) covering gas. Mobile bundles the
 * pair via executeVaultTransaction (TX1-TX4 + TX5).
 */
router.post('/badge/mint', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vaultAddress = req.user?.vaultAddress;
    if (!vaultAddress) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }
    const { taskSlug } = req.body ?? {};
    if (typeof taskSlug !== 'string' || !taskSlug) {
      res.status(400).json({ success: false, error: 'taskSlug is required' });
      return;
    }

    const built = await buildBadgeMint(vaultAddress, taskSlug);
    res.json({ success: true, data: built });
  } catch (err: any) {
    if (err instanceof PassportNotActivatedError) {
      res.status(400).json({ success: false, error: err.message, errorCode: 'PASSPORT_NOT_ACTIVATED' });
      return;
    }
    if (err instanceof TaskNotClaimableError) {
      res.status(400).json({ success: false, error: err.message, errorCode: 'NOT_CLAIMABLE', status: err.status });
      return;
    }
    if (err instanceof TaskSoldOutError) {
      res.status(409).json({ success: false, error: err.message, errorCode: 'SOLD_OUT' });
      return;
    }
    if (err instanceof TaskInactiveError) {
      res.status(409).json({ success: false, error: err.message, errorCode: 'INACTIVE' });
      return;
    }
    console.error('POST /rewards/v2/badge/mint error:', err);
    res.status(500).json({ success: false, error: err?.message ?? 'Failed to build badge mint' });
  }
});

/**
 * POST /rewards/v2/badge/mint/confirm
 * Body: { badgeMintId, bundleSignatures: string[] }
 */
router.post('/badge/mint/confirm', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vaultAddress = req.user?.vaultAddress;
    if (!vaultAddress) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }
    const { badgeMintId, bundleSignatures } = req.body ?? {};
    if (!badgeMintId || !Array.isArray(bundleSignatures)) {
      res.status(400).json({ success: false, error: 'badgeMintId and bundleSignatures are required' });
      return;
    }

    const outcome = await recordAndConfirmBadgeMint(badgeMintId, vaultAddress, bundleSignatures);
    res.json({ success: true, status: outcome });
  } catch (err: any) {
    console.error('POST /rewards/v2/badge/mint/confirm error:', err);
    const status = err?.message === 'Badge mint attempt not found' ? 404 : 500;
    res.status(status).json({ success: false, error: err?.message ?? 'Failed to confirm badge mint' });
  }
});

export default router;
