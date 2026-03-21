import { Router, Request, Response } from 'express';
import { RecoveryProposalModel, RecoveryProposalStatus } from '../models/RecoveryProposal';
import { signTransactionWithPrivy } from '../services/privyService';
import { JitoManager } from '../managers';
import path from 'path';

const router = Router();
const jitoManager = new JitoManager();

// Simple in-memory cache for gPA results (expensive call)
let cachedMultisigs: { pubkey: string; members: { key: string; permissions: number }[]; threshold: number; createKey: string }[] = [];
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

async function fetchAllMultisigs() {
  const now = Date.now();
  if (cachedMultisigs.length > 0 && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedMultisigs;
  }

  const multisigLib = await import('@sqds/multisig');
  const { Connection } = await import('@solana/web3.js');
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const conn = new Connection(rpcUrl);

  const gpa = multisigLib.accounts.Multisig.gpaBuilder();
  const allAccounts = await gpa.run(conn);

  const results: typeof cachedMultisigs = [];

  for (const { pubkey, account } of allAccounts) {
    try {
      const [data] = multisigLib.accounts.Multisig.fromAccountInfo(account);
      results.push({
        pubkey: pubkey.toBase58(),
        members: data.members.map((m: any) => ({
          key: m.key.toBase58(),
          permissions: m.permissions.mask,
        })),
        threshold: data.threshold,
        createKey: data.createKey.toBase58(),
      });
    } catch {
      // Skip malformed accounts
    }
  }

  cachedMultisigs = results;
  cacheTimestamp = now;
  return results;
}

/**
 * POST /find-vaults
 * Find all Squads V4 multisigs where a given address is a member.
 * Body: { memberAddress: string, cloudKey?: string }
 */
router.post('/find-vaults', async (req: Request, res: Response) => {
  try {
    const { memberAddress, cloudKey } = req.body;
    if (!memberAddress || typeof memberAddress !== 'string') {
      res.status(400).json({ success: false, error: 'memberAddress is required' });
      return;
    }

    const multisigLib = await import('@sqds/multisig');
    const { PublicKey } = await import('@solana/web3.js');

    const allMultisigs = await fetchAllMultisigs();

    // Filter for multisigs containing this member
    const matches = allMultisigs.filter((ms) =>
      ms.members.some((m) => m.key === memberAddress),
    );

    // Build response with vault PDAs
    const multisigs = matches.map((ms) => {
      const multisigPda = new PublicKey(ms.pubkey);
      const [vaultPda] = multisigLib.getVaultPda({ multisigPda, index: 0 });

      return {
        multisigAddress: ms.pubkey,
        vaultAddress: vaultPda.toBase58(),
        threshold: ms.threshold,
        memberCount: ms.members.length,
        members: ms.members.map((m) => ({
          address: m.key,
          permissions: {
            initiate: (m.permissions & 1) !== 0,
            vote: (m.permissions & 2) !== 0,
            execute: (m.permissions & 4) !== 0,
          },
        })),
        matchesCloudKey: cloudKey ? ms.members.some((m) => m.key === cloudKey) : undefined,
      };
    });

    res.json({ success: true, data: { multisigs } });
  } catch (error) {
    console.error('Error finding vaults by member:', error);
    res.status(500).json({ success: false, error: 'Failed to find vaults' });
  }
});

/**
 * POST /create-proposal
 * Store a recovery proposal with pre-built transactions.
 * The mobile app builds TX1/TX2 and sends them here for multi-party signing.
 */
router.post('/create-proposal', async (req: Request, res: Response) => {
  try {
    const {
      multisigAddress,
      vaultAddress,
      transactionIndex,
      threshold,
      actions,
      tx1MessageBase64,
      tx1Base64,
      tx2Base64,
      blockhash,
      requiredSigners,
      collectedSignatures,
      createdByWallet,
    } = req.body;

    if (!multisigAddress || !tx1Base64 || !tx2Base64 || !requiredSigners?.length) {
      res.status(400).json({ success: false, error: 'Missing required fields' });
      return;
    }

    const proposal = await RecoveryProposalModel.create({
      multisigAddress,
      vaultAddress,
      transactionIndex,
      threshold,
      actions: actions || [],
      tx1MessageBase64,
      tx1Base64,
      tx2Base64,
      blockhash,
      requiredSigners,
      collectedSignatures: collectedSignatures || [],
      status: RecoveryProposalStatus.PENDING,
      createdByWallet,
    });

    // Check if already at threshold
    if ((collectedSignatures?.length || 0) >= threshold) {
      proposal.status = RecoveryProposalStatus.READY;
      await proposal.save();
    }

    res.json({
      success: true,
      data: {
        proposalId: proposal._id!.toString(),
        status: proposal.status,
        signaturesCollected: proposal.collectedSignatures.length,
        signaturesRequired: threshold,
      },
    });
  } catch (error) {
    console.error('Error creating recovery proposal:', error);
    res.status(500).json({ success: false, error: 'Failed to create proposal' });
  }
});

/**
 * GET /proposal/:proposalId
 * Get proposal status, required signers, and collected signatures.
 */
router.get('/proposal/:proposalId', async (req: Request, res: Response) => {
  try {
    const proposal = await RecoveryProposalModel.findById(req.params.proposalId);
    if (!proposal) {
      res.status(404).json({ success: false, error: 'Proposal not found' });
      return;
    }

    const signedAddresses = new Set(proposal.collectedSignatures.map(s => s.address));

    res.json({
      success: true,
      data: {
        proposalId: proposal._id!.toString(),
        multisigAddress: proposal.multisigAddress,
        vaultAddress: proposal.vaultAddress,
        threshold: proposal.threshold,
        status: proposal.status,
        actions: proposal.actions,
        signaturesCollected: proposal.collectedSignatures.length,
        requiredSigners: proposal.requiredSigners.map(s => ({
          ...s,
          signed: signedAddresses.has(s.address),
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching proposal:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch proposal' });
  }
});

/**
 * POST /proposal/:proposalId/submit-signature
 * Submit a signature from an external wallet or other signer.
 */
router.post('/proposal/:proposalId/submit-signature', async (req: Request, res: Response) => {
  try {
    const { address, signature } = req.body;
    if (!address || !signature) {
      res.status(400).json({ success: false, error: 'address and signature are required' });
      return;
    }

    const proposal = await RecoveryProposalModel.findById(req.params.proposalId);
    if (!proposal) {
      res.status(404).json({ success: false, error: 'Proposal not found' });
      return;
    }

    if (proposal.status === RecoveryProposalStatus.EXECUTED) {
      res.status(400).json({ success: false, error: 'Proposal already executed' });
      return;
    }

    // Verify the address is a required signer
    const isRequired = proposal.requiredSigners.some(s => s.address === address);
    if (!isRequired) {
      res.status(400).json({ success: false, error: 'Address is not a required signer' });
      return;
    }

    // Check if already signed
    const alreadySigned = proposal.collectedSignatures.some(s => s.address === address);
    if (alreadySigned) {
      res.status(400).json({ success: false, error: 'Already signed' });
      return;
    }

    proposal.collectedSignatures.push({
      address,
      signature,
      collectedAt: new Date(),
    });

    // Check if threshold reached
    if (proposal.collectedSignatures.length >= proposal.threshold) {
      proposal.status = RecoveryProposalStatus.READY;
    }

    await proposal.save();

    res.json({
      success: true,
      data: {
        signaturesCollected: proposal.collectedSignatures.length,
        signaturesRequired: proposal.threshold,
        status: proposal.status,
      },
    });
  } catch (error) {
    console.error('Error submitting signature:', error);
    res.status(500).json({ success: false, error: 'Failed to submit signature' });
  }
});

/**
 * POST /proposal/:proposalId/sign-privy
 * Sign the proposal using a Privy embedded wallet (email recovery key).
 */
router.post('/proposal/:proposalId/sign-privy', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ success: false, error: 'email is required' });
      return;
    }

    const proposal = await RecoveryProposalModel.findById(req.params.proposalId);
    if (!proposal) {
      res.status(404).json({ success: false, error: 'Proposal not found' });
      return;
    }

    if (proposal.status === RecoveryProposalStatus.EXECUTED) {
      res.status(400).json({ success: false, error: 'Proposal already executed' });
      return;
    }

    // Sign the transaction with Privy
    const { signature, address } = await signTransactionWithPrivy(email, proposal.tx1Base64);

    // Verify the address is a required signer
    const isRequired = proposal.requiredSigners.some(s => s.address === address);
    if (!isRequired) {
      res.status(400).json({ success: false, error: 'Privy wallet is not a required signer for this proposal' });
      return;
    }

    // Check if already signed
    const alreadySigned = proposal.collectedSignatures.some(s => s.address === address);
    if (!alreadySigned) {
      proposal.collectedSignatures.push({
        address,
        signature,
        collectedAt: new Date(),
      });

      if (proposal.collectedSignatures.length >= proposal.threshold) {
        proposal.status = RecoveryProposalStatus.READY;
      }

      await proposal.save();
    }

    res.json({
      success: true,
      data: {
        signaturesCollected: proposal.collectedSignatures.length,
        signaturesRequired: proposal.threshold,
        status: proposal.status,
        signerAddress: address,
      },
    });
  } catch (error: any) {
    console.error('Error signing with Privy:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to sign with Privy' });
  }
});

/**
 * GET /proposal/:proposalId/assembled-tx
 * Get the fully assembled TX1+TX2 with all collected signatures inserted.
 * Only available when status is 'ready'.
 */
router.get('/proposal/:proposalId/assembled-tx', async (req: Request, res: Response) => {
  try {
    const proposal = await RecoveryProposalModel.findById(req.params.proposalId);
    if (!proposal) {
      res.status(404).json({ success: false, error: 'Proposal not found' });
      return;
    }

    if (proposal.status !== RecoveryProposalStatus.READY) {
      res.status(400).json({
        success: false,
        error: `Proposal is ${proposal.status}, need ${proposal.threshold - proposal.collectedSignatures.length} more signatures`,
      });
      return;
    }

    // Return the raw tx bytes and signatures — mobile app assembles them
    res.json({
      success: true,
      data: {
        tx1Base64: proposal.tx1Base64,
        tx2Base64: proposal.tx2Base64,
        signatures: proposal.collectedSignatures.map(s => ({
          address: s.address,
          signature: s.signature,
        })),
      },
    });
  } catch (error) {
    console.error('Error assembling tx:', error);
    res.status(500).json({ success: false, error: 'Failed to assemble transaction' });
  }
});

/**
 * POST /proposal/:proposalId/mark-executed
 * Mark proposal as executed after on-chain confirmation.
 */
router.post('/proposal/:proposalId/mark-executed', async (req: Request, res: Response) => {
  try {
    const { signature } = req.body;

    const proposal = await RecoveryProposalModel.findById(req.params.proposalId);
    if (!proposal) {
      res.status(404).json({ success: false, error: 'Proposal not found' });
      return;
    }

    proposal.status = RecoveryProposalStatus.EXECUTED;
    proposal.executionSignature = signature;
    await proposal.save();

    res.json({ success: true });
  } catch (error) {
    console.error('Error marking proposal executed:', error);
    res.status(500).json({ success: false, error: 'Failed to update proposal' });
  }
});

/**
 * POST /proposal/:proposalId/send-bundle
 * Send the recovery transaction bundle via Jito.
 * No auth required — tied to a specific proposal.
 */
router.post('/proposal/:proposalId/send-bundle', async (req: Request, res: Response) => {
  try {
    const { transactions } = req.body;

    if (!Array.isArray(transactions) || transactions.length === 0 || transactions.length > 5) {
      res.status(400).json({ success: false, error: 'transactions must be 1-5 base64 transactions' });
      return;
    }

    const proposal = await RecoveryProposalModel.findById(req.params.proposalId);
    if (!proposal) {
      res.status(404).json({ success: false, error: 'Proposal not found' });
      return;
    }

    if (proposal.status === RecoveryProposalStatus.EXECUTED) {
      res.status(400).json({ success: false, error: 'Already executed' });
      return;
    }

    // Send via Jito
    const bundleId = await jitoManager.sendBundle(transactions);
    console.log(`Recovery bundle sent: ${bundleId} (${transactions.length} txs)`);

    // Poll for confirmation
    let status = null;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      status = await jitoManager.getBundleStatus(bundleId);
      if (status?.confirmation_status === 'confirmed' || status?.confirmation_status === 'finalized') break;
      if (status?.err && !('Ok' in status.err)) break;
    }

    if (status?.err && !('Ok' in status.err)) {
      res.status(400).json({ success: false, error: 'Bundle execution failed', bundleId });
      return;
    }

    // Mark proposal as executed
    proposal.status = RecoveryProposalStatus.EXECUTED;
    proposal.executionSignature = bundleId;
    await proposal.save();

    res.json({
      success: true,
      bundleId,
      status: status?.confirmation_status ?? 'pending',
    });
  } catch (error: any) {
    console.error('Error sending recovery bundle:', error);
    res.status(500).json({ success: false, error: error?.message || 'Failed to send bundle' });
  }
});

/**
 * GET /sign/:proposalId
 * Serve the external wallet signing web page.
 */
router.get('/sign/:proposalId', async (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'recovery-sign.html'));
});

export default router;
