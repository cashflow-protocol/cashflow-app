import { Router, Request, Response } from 'express';
import { RecoveryProposalModel, RecoveryProposalStatus } from '../models/RecoveryProposal';
import { signTransactionWithPrivy } from '../services/privyService';
import { JitoManager } from '../managers';


const router = Router();
const jitoManager = new JitoManager();

const SQUADS_V4_API = 'https://v4-api.squads.so';

/**
 * Fetch multisigs for a member address using the Squads V4 API.
 */
async function fetchMultisigsFromSquadsApi(memberAddress: string) {
  const r = await fetch(`${SQUADS_V4_API}/multisigs/${memberAddress}?useProd=true`);
  if (!r.ok) return [];
  const data = await r.json();
  if (!Array.isArray(data)) return [];
  return data;
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

    // Query Squads V4 API for both memberAddress and cloudKey
    const queries = [fetchMultisigsFromSquadsApi(memberAddress)];
    if (cloudKey && cloudKey !== memberAddress) {
      queries.push(fetchMultisigsFromSquadsApi(cloudKey));
    }
    const results = await Promise.all(queries);

    // Deduplicate by multisig address
    const seen = new Set<string>();
    const multisigs = [];
    for (const batch of results) {
      for (const ms of batch) {
        if (seen.has(ms.address)) continue;
        seen.add(ms.address);

        const members = ms.account?.members || [];
        multisigs.push({
          multisigAddress: ms.address,
          vaultAddress: ms.defaultVault,
          threshold: ms.account?.threshold ?? 1,
          memberCount: members.length,
          members: members.map((m: any) => ({
            address: m.key,
            permissions: {
              initiate: (m.permissions?.mask & 1) !== 0,
              vote: (m.permissions?.mask & 2) !== 0,
              execute: (m.permissions?.mask & 4) !== 0,
            },
          })),
          matchesCloudKey: cloudKey
            ? members.some((m: any) => m.key === cloudKey)
            : undefined,
        });
      }
    }

    res.json({ success: true, data: { multisigs } });
  } catch (error) {
    console.error('Error finding vaults by member:', error);
    res.status(500).json({ success: false, error: 'Failed to find vaults' });
  }
});

/**
 * POST /find-vault-by-address
 * Look up a specific Squads V4 multisig by its multisig or vault address.
 * Body: { address: string }
 */
router.post('/find-vault-by-address', async (req: Request, res: Response) => {
  try {
    const { address } = req.body;
    if (!address || typeof address !== 'string') {
      res.status(400).json({ success: false, error: 'address is required' });
      return;
    }

    // The Squads API /multisigs/:address works for member lookups,
    // but for a direct multisig lookup we need a different approach.
    // Try fetching the multisig account directly via Solana RPC.
    const { Connection, PublicKey } = await import('@solana/web3.js');
    const multisigLib = await import('@sqds/multisig');
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const conn = new Connection(rpcUrl);

    // Try the address as a multisig PDA first
    let multisigPda: InstanceType<typeof PublicKey>;
    let multisigData: any;
    let vaultAddress: string;

    try {
      multisigPda = new PublicKey(address);
      multisigData = await multisigLib.accounts.Multisig.fromAccountAddress(conn, multisigPda);
      const [vaultPda] = multisigLib.getVaultPda({ multisigPda, index: 0 });
      vaultAddress = vaultPda.toBase58();
    } catch {
      // Not a valid multisig address — try treating it as a vault address
      // and search for it via the Squads API using each member
      // Since we can't reverse a vault PDA, return not found
      res.json({ success: true, data: { multisig: null } });
      return;
    }

    const members = multisigData.members.map((m: any) => ({
      address: m.key.toBase58(),
      permissions: {
        initiate: (m.permissions.mask & 1) !== 0,
        vote: (m.permissions.mask & 2) !== 0,
        execute: (m.permissions.mask & 4) !== 0,
      },
    }));

    res.json({
      success: true,
      data: {
        multisig: {
          multisigAddress: multisigPda.toBase58(),
          vaultAddress,
          threshold: multisigData.threshold,
          memberCount: members.length,
          members,
        },
      },
    });
  } catch (error) {
    console.error('Error finding vault by address:', error);
    res.status(500).json({ success: false, error: 'Failed to find vault' });
  }
});

/**
 * POST /build-proposal-tx
 * Build TX1 (configTransactionCreate + proposalCreate + proposalApprove) with fresh blockhash.
 * Mobile signs it and sends back via /create-proposal.
 */
router.post('/build-proposal-tx', async (req: Request, res: Response) => {
  try {
    const { multisigAddress, walletAddress, members, cloudKey, addMemberActions } = req.body;
    if (!multisigAddress || !walletAddress || !addMemberActions?.length) {
      res.status(400).json({ success: false, error: 'Missing required fields' });
      return;
    }

    const multisigLib = await import('@sqds/multisig');
    const { Connection, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } = await import('@solana/web3.js');
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const conn = new Connection(rpcUrl, 'confirmed');

    const multisigPda = new PublicKey(multisigAddress);
    const walletPubkey = new PublicKey(walletAddress);
    const { Permissions } = multisigLib.types;

    // Get current transaction index from on-chain
    const multisigAccount = await multisigLib.accounts.Multisig.fromAccountAddress(conn, multisigPda);
    const transactionIndex = BigInt(multisigAccount.transactionIndex.toString()) + 1n;

    // Build add member actions for the Squads instruction
    const parsedActions = addMemberActions.map((a: any) => ({
      __kind: 'AddMember' as const,
      newMember: {
        key: new PublicKey(a.memberAddress),
        permissions: Permissions.all(),
      },
    }));

    // Build TX1 instructions
    const tx1Instructions = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
      multisigLib.instructions.configTransactionCreate({
        multisigPda,
        transactionIndex,
        creator: walletPubkey,
        rentPayer: walletPubkey,
        actions: parsedActions,
      }),
      multisigLib.instructions.proposalCreate({
        multisigPda,
        transactionIndex,
        creator: walletPubkey,
        rentPayer: walletPubkey,
      }),
      multisigLib.instructions.proposalApprove({
        multisigPda,
        transactionIndex,
        member: walletPubkey,
      }),
    ];

    // Jito tip for landing on mainnet
    const { SystemProgram } = await import('@solana/web3.js');
    const JITO_TIP_ACCOUNTS = [
      'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
      'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
      'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
      'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
      '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
      'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
      'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
      '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
    ];
    const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
    tx1Instructions.push(SystemProgram.transfer({
      fromPubkey: walletPubkey,
      toPubkey: new PublicKey(tipAccount),
      lamports: 100_000,
    }));

    // Cloud key approves too if provided
    if (cloudKey) {
      const cloudPubkey = new PublicKey(cloudKey);
      const isMember = (members || []).some((m: any) => m.address === cloudKey);
      if (isMember) {
        tx1Instructions.push(multisigLib.instructions.proposalApprove({
          multisigPda,
          transactionIndex,
          member: cloudPubkey,
        }));
      }
    }

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
    console.log(`[build-proposal-tx] RPC: ${rpcUrl}`);
    console.log(`[build-proposal-tx] blockhash: ${blockhash}, lastValidBlockHeight: ${lastValidBlockHeight}`);

    const msg = new TransactionMessage({
      payerKey: walletPubkey,
      recentBlockhash: blockhash,
      instructions: tx1Instructions,
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    console.log(`[build-proposal-tx] TX1 size: ${tx.serialize().length} bytes, signers: ${tx.message.staticAccountKeys.length} accounts`);

    // Also build TX2 (execute) — stored for later use after threshold is met
    const tx2Instructions = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
      multisigLib.instructions.configTransactionExecute({
        multisigPda,
        transactionIndex,
        member: walletPubkey,
        rentPayer: walletPubkey,
      }),
    ];
    if (multisigAccount.rentCollector) {
      tx2Instructions.push(multisigLib.instructions.configTransactionAccountsClose({
        multisigPda,
        transactionIndex,
        rentCollector: new PublicKey(multisigAccount.rentCollector),
      }));
    }
    const msg2 = new TransactionMessage({
      payerKey: walletPubkey,
      recentBlockhash: blockhash,
      instructions: tx2Instructions,
    }).compileToV0Message();
    const tx2 = new VersionedTransaction(msg2);

    res.json({
      success: true,
      data: {
        tx1Base64: Buffer.from(tx.serialize()).toString('base64'),
        tx2Base64: Buffer.from(tx2.serialize()).toString('base64'),
        transactionIndex: Number(transactionIndex),
        blockhash,
        lastValidBlockHeight,
        threshold: multisigAccount.threshold,
      },
    });
  } catch (error: any) {
    console.error('Error building proposal tx:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to build proposal transaction' });
  }
});



/**
 * POST /create-proposal
 * Store a recovery proposal after TX1 has been confirmed on-chain.
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

    if (!multisigAddress || !requiredSigners?.length) {
      res.status(400).json({ success: false, error: 'Missing required fields' });
      return;
    }

    const proposal = await RecoveryProposalModel.create({
      multisigAddress,
      vaultAddress,
      transactionIndex,
      threshold,
      actions: actions || [],
      tx1MessageBase64: tx1MessageBase64 || '',
      tx1Base64: tx1Base64 || '',
      tx2Base64: tx2Base64 || '',
      blockhash: blockhash || '',
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
        tx1Base64: proposal.tx1Base64,
        requiredSigners: proposal.requiredSigners.map(s => ({
          address: s.address,
          type: s.type,
          label: s.label,
          email: s.email,
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
 * POST /proposal/:proposalId/build-approve-tx
 * Build a proposalApprove transaction for a given member to sign and send.
 * Body: { memberAddress: string }
 */
router.post('/proposal/:proposalId/build-approve-tx', async (req: Request, res: Response) => {
  try {
    const { memberAddress } = req.body;
    if (!memberAddress) {
      res.status(400).json({ success: false, error: 'memberAddress is required' });
      return;
    }

    const proposal = await RecoveryProposalModel.findById(req.params.proposalId);
    if (!proposal) {
      res.status(404).json({ success: false, error: 'Proposal not found' });
      return;
    }

    // Verify this address is a required signer
    const isRequired = proposal.requiredSigners.some(s => s.address === memberAddress);
    if (!isRequired) {
      res.status(400).json({ success: false, error: 'Address is not a required signer' });
      return;
    }

    const multisigLib = await import('@sqds/multisig');
    const { Connection, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } = await import('@solana/web3.js');
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const conn = new Connection(rpcUrl);

    const multisigPda = new PublicKey(proposal.multisigAddress);
    const memberPubkey = new PublicKey(memberAddress);
    const transactionIndex = BigInt(proposal.transactionIndex);

    // Build proposalApprove instruction with priority fees
    const approveIx = multisigLib.instructions.proposalApprove({
      multisigPda,
      transactionIndex,
      member: memberPubkey,
    });

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');

    const msg = new TransactionMessage({
      payerKey: memberPubkey,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
        approveIx,
      ],
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);
    const txBase64 = Buffer.from(tx.serialize()).toString('base64');

    res.json({
      success: true,
      data: {
        transaction: txBase64,
        blockhash,
        lastValidBlockHeight,
      },
    });
  } catch (error: any) {
    console.error('Error building approve tx:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to build approve transaction' });
  }
});

/**
 * POST /proposal/:proposalId/send-approve-tx
 * Send a signed proposalApprove transaction on-chain.
 * Body: { signedTransaction: string (base64) }
 */
router.post('/proposal/:proposalId/send-approve-tx', async (req: Request, res: Response) => {
  try {
    const { signedTransaction } = req.body;
    if (!signedTransaction) {
      res.status(400).json({ success: false, error: 'signedTransaction is required' });
      return;
    }

    const { Connection } = await import('@solana/web3.js');
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const conn = new Connection(rpcUrl, 'confirmed');

    const txBytes = Buffer.from(signedTransaction, 'base64');

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');

    const signature = await conn.sendRawTransaction(txBytes, { skipPreflight: true, maxRetries: 0 });
    console.log(`Approve TX sent: ${signature}`);

    const resendInterval = setInterval(async () => {
      try {
        await conn.sendRawTransaction(txBytes, { skipPreflight: true, maxRetries: 0 });
      } catch {}
    }, 2000);

    try {
      await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      console.log(`Approve TX confirmed: ${signature}`);
    } finally {
      clearInterval(resendInterval);
    }

    res.json({ success: true, data: { signature } });
  } catch (error: any) {
    console.error('Error sending approve tx:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to send transaction' });
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
    const privyError = error?.response?.data || error?.message || 'Failed to sign with Privy';
    console.error('Error signing with Privy:', JSON.stringify(privyError, null, 2));
    res.status(500).json({ success: false, error: typeof privyError === 'string' ? privyError : JSON.stringify(privyError) });
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
 * Redirect to the website recovery page.
 */
router.get('/sign/:proposalId', async (req: Request, res: Response) => {
  res.redirect(`https://cashflow.fun/recovery/${req.params.proposalId}`);
});

export default router;
