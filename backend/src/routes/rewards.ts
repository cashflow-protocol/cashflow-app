import { Router, Response } from 'express';
import { getBase58Encoder } from '@solana/kit';
import type { AuthenticatedRequest } from '../middleware/auth';
import { rewardManager } from '../managers/RewardManager';
import { RewardMintBuilder } from '../managers/RewardMintBuilder';
import { UserModel } from '../models/User';
import {
  RewardTaskModel,
} from '../models/RewardTask';
import {
  UserRewardProgressModel,
  RewardProgressStatus,
} from '../models/UserRewardProgress';
import {
  MintedBadgeModel,
  MintedBadgeStatus,
} from '../models/MintedBadge';
import { isValidSolanaAddress } from '../utils/validation';
import { createChallenge, consumeChallenge } from '../services/challengeStore';

const router = Router();

let _mintBuilder: RewardMintBuilder | null = null;
function getMintBuilder(): RewardMintBuilder {
  if (!_mintBuilder) _mintBuilder = new RewardMintBuilder();
  return _mintBuilder;
}

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
    const tasks = await rewardManager.getTasksForVault(vaultAddress);
    res.json({ success: true, data: { tasks } });
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
 * POST /rewards/v2/mint
 * Body: { taskSlug }
 * Atomically claims a slot, transitions progress to mint_pending, builds the
 * standalone Metaplex Core mint TX (pre-signed by admin + asset), and returns
 * inner instructions for the user's vault execute (fee transfer to treasury).
 *
 * Mobile flow: wraps innerInstructions in vault TX1-TX4 via executeVaultTransaction,
 * appends mintTransactionBase64 as TX5, and sends bundle.
 */
router.post('/mint', async (req: AuthenticatedRequest, res: Response) => {
  let claimedSlot = false;
  let claimedSlug: string | null = null;
  let transitionedSlug: string | null = null;
  let mintedBadgeId: string | null = null;

  try {
    const vaultAddress = req.user?.vaultAddress;
    if (!vaultAddress) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }
    const { taskSlug } = req.body ?? {};
    if (!taskSlug || typeof taskSlug !== 'string') {
      res.status(400).json({ success: false, error: 'taskSlug is required' });
      return;
    }

    // 1. Recompute progress (defense-in-depth)
    const evaluation = await rewardManager.forceEvaluate(vaultAddress, taskSlug);
    if (evaluation.status !== RewardProgressStatus.CLAIMABLE) {
      res.status(409).json({
        success: false,
        error: `Task is not claimable (status=${evaluation.status})`,
      });
      return;
    }

    // 2. Atomic slot claim — increment mintedCount only if still under maxSupply.
    // Use a standard $or with the regular `null` operator (which matches missing
    // fields too) for the unlimited case, and $expr only for the field-vs-field
    // comparison. $expr's $eq-vs-null is inconsistent across server versions.
    const claimedTask = await RewardTaskModel.findOneAndUpdate(
      {
        slug: taskSlug,
        active: true,
        $or: [
          { maxSupply: null },
          { $expr: { $lt: ['$mintedCount', '$maxSupply'] } },
        ],
      },
      { $inc: { mintedCount: 1 } },
      { new: true },
    );
    if (!claimedTask) {
      // Diagnose the failure so the user gets a meaningful error.
      const existing = await RewardTaskModel.findOne({ slug: taskSlug }).lean();
      let reason = 'Sold out';
      if (!existing) reason = 'Task not found';
      else if (!existing.active) reason = 'Task is not active';
      else if (existing.maxSupply != null && existing.mintedCount >= existing.maxSupply) reason = 'Sold out';
      else reason = `Slot claim failed (mintedCount=${existing.mintedCount}, maxSupply=${existing.maxSupply ?? '∞'}, active=${existing.active})`;
      console.warn(`[mint] slot claim failed for ${taskSlug}:`, reason, existing);
      res.status(409).json({ success: false, error: reason });
      return;
    }
    claimedSlot = true;
    claimedSlug = taskSlug;
    const mintedSequence = claimedTask.mintedCount;

    // 3. Atomic state transition: claimable → mint_pending
    const transitioned = await UserRewardProgressModel.findOneAndUpdate(
      { vaultAddress, taskSlug, status: RewardProgressStatus.CLAIMABLE },
      { $set: { status: RewardProgressStatus.MINT_PENDING } },
      { new: true },
    );
    if (!transitioned) {
      // Rollback slot
      await RewardTaskModel.updateOne({ slug: taskSlug }, { $inc: { mintedCount: -1 } });
      claimedSlot = false;
      res.status(409).json({ success: false, error: 'Already minting or already minted' });
      return;
    }
    transitionedSlug = taskSlug;

    // 4. Build mint transaction
    const builder = getMintBuilder();
    const built = await builder.buildMintTransaction({
      task: claimedTask as any,
      vaultAddress,
    });
    const collectionAddress = await builder.getCollectionAddress();

    // 5. Insert MintedBadge record (status=pending)
    const badge = await MintedBadgeModel.create({
      vaultAddress,
      taskSlug,
      mintedSequence,
      assetAddress: built.assetAddress,
      collectionAddress,
      status: MintedBadgeStatus.PENDING,
      bundleSignatures: [],
      feeAmount: claimedTask.mintFeeLamports,
    });
    mintedBadgeId = String(badge._id);

    // Link badge to progress
    await UserRewardProgressModel.updateOne(
      { vaultAddress, taskSlug },
      { $set: { mintedBadgeId } },
    );

    res.json({
      success: true,
      data: {
        mintedBadgeId,
        assetAddress: built.assetAddress,
        innerInstructions: built.innerInstructions,
        mintTransactionBase64: built.mintTransactionBase64,
        blockhash: built.blockhash,
        collectionAddress,
        mintFeeLamports: claimedTask.mintFeeLamports,
      },
    });
  } catch (err: any) {
    console.error('POST /rewards/v2/mint error:', err);

    // Rollback in reverse order on failure
    if (transitionedSlug && req.user?.vaultAddress) {
      await UserRewardProgressModel.updateOne(
        { vaultAddress: req.user.vaultAddress, taskSlug: transitionedSlug, status: RewardProgressStatus.MINT_PENDING },
        { $set: { status: RewardProgressStatus.CLAIMABLE } },
      ).catch(() => {});
    }
    if (claimedSlot && claimedSlug) {
      await RewardTaskModel.updateOne(
        { slug: claimedSlug },
        { $inc: { mintedCount: -1 } },
      ).catch(() => {});
    }
    if (mintedBadgeId) {
      await MintedBadgeModel.deleteOne({ _id: mintedBadgeId }).catch(() => {});
    }
    res.status(500).json({ success: false, error: err?.message ?? 'Failed to build mint' });
  }
});

/**
 * POST /rewards/v2/mint/confirm
 * Body: { mintedBadgeId, bundleSignatures: string[] }
 * Mobile calls this immediately after sending the bundle so the backend can
 * try to confirm the mint synchronously. The recovery cron is the failsafe.
 */
router.post('/mint/confirm', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const vaultAddress = req.user?.vaultAddress;
    if (!vaultAddress) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }
    const { mintedBadgeId, bundleSignatures } = req.body ?? {};
    if (!mintedBadgeId || !Array.isArray(bundleSignatures)) {
      res.status(400).json({ success: false, error: 'mintedBadgeId and bundleSignatures are required' });
      return;
    }

    const badge = await MintedBadgeModel.findOne({ _id: mintedBadgeId, vaultAddress });
    if (!badge) {
      res.status(404).json({ success: false, error: 'Badge not found' });
      return;
    }

    // Optimistically record signatures; recovery cron will verify on-chain.
    badge.bundleSignatures = bundleSignatures;
    badge.status = MintedBadgeStatus.PENDING;
    await badge.save();

    res.json({ success: true });
  } catch (err) {
    console.error('POST /rewards/v2/mint/confirm error:', err);
    res.status(500).json({ success: false, error: 'Failed to record confirmation' });
  }
});

export default router;
