import { Router, Request, Response } from 'express';
import { RecoveryProposalModel, RecoveryProposalStatus } from '../models/RecoveryProposal';
import { UserModel } from '../models';
import { signTransactionWithPrivy } from '../services/privyService';
import { HeliusSender } from '../managers';

const router = Router();

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

    // Try as multisig PDA first (on-chain lookup)
    try {
      multisigPda = new PublicKey(address);
      multisigData = await multisigLib.accounts.Multisig.fromAccountAddress(conn, multisigPda);
      const [vaultPda] = multisigLib.getVaultPda({ multisigPda, index: 0 });
      vaultAddress = vaultPda.toBase58();
    } catch {
      // Not a multisig PDA — try Squads API (works for member addresses,
      // and we can check if the address matches a vault address)
      try {
        const squadsRes = await fetch(`${SQUADS_V4_API}/multisigs/${address}?useProd=true`);
        if (squadsRes.ok) {
          const squadsData = await squadsRes.json();
          if (Array.isArray(squadsData) && squadsData.length > 0) {
            // Address is a member — return the first multisig
            const ms = squadsData[0];
            const members = ms.account?.members || [];
            res.json({
              success: true,
              data: {
                multisig: {
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
                },
              },
            });
            return;
          }
        }
      } catch {}

      // Try as vault address — look up in our User DB to find a member,
      // then use Squads API with that member to get the multisig
      try {
        const user = await UserModel.findOne({ vaultAddress: address }).lean();
        if (user?.publicKey) {
          const squadsRes2 = await fetch(`${SQUADS_V4_API}/multisigs/${user.publicKey}?useProd=true`);
          if (squadsRes2.ok) {
            const squadsData2 = await squadsRes2.json();
            if (Array.isArray(squadsData2)) {
              // Find the multisig whose defaultVault matches
              const match = squadsData2.find((ms: any) => ms.defaultVault === address);
              if (match) {
                const members2 = match.account?.members || [];
                res.json({
                  success: true,
                  data: {
                    multisig: {
                      multisigAddress: match.address,
                      vaultAddress: match.defaultVault,
                      threshold: match.account?.threshold ?? 1,
                      memberCount: members2.length,
                      members: members2.map((m: any) => ({
                        address: m.key,
                        permissions: {
                          initiate: (m.permissions?.mask & 1) !== 0,
                          vote: (m.permissions?.mask & 2) !== 0,
                          execute: (m.permissions?.mask & 4) !== 0,
                        },
                      })),
                    },
                  },
                });
                return;
              }
            }
          }
        }
      } catch {}

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

    // Helius SWQoS tip for landing on mainnet
    tx1Instructions.push(HeliusSender.createTipIx(walletPubkey));

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

    const msg = new TransactionMessage({
      payerKey: walletPubkey,
      recentBlockhash: blockhash,
      instructions: tx1Instructions,
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);

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
 * POST /lookup-privy-emails
 * Look up Privy email addresses for given Solana wallet addresses.
 * Body: { addresses: string[] }
 */
router.post('/lookup-privy-emails', async (req: Request, res: Response) => {
  try {
    const { addresses } = req.body;
    if (!Array.isArray(addresses)) {
      res.status(400).json({ success: false, error: 'addresses array is required' });
      return;
    }

    const { lookupPrivyEmails } = await import('../services/privyService');
    const emails = await lookupPrivyEmails(addresses);

    res.json({ success: true, data: { emails } });
  } catch (error: any) {
    console.error('Error looking up Privy emails:', error);
    res.status(500).json({ success: false, error: 'Failed to look up emails' });
  }
});

/**
 * POST /send-recovery-tx
 * Send a signed transaction via Helius SWQoS and wait for confirmation.
 * Body: { transaction: string (base64) }
 */
router.post('/send-recovery-tx', async (req: Request, res: Response) => {
  try {
    const { transaction } = req.body;
    if (!transaction) {
      res.status(400).json({ success: false, error: 'transaction is required' });
      return;
    }

    const signature = await HeliusSender.sendAndConfirm(transaction);
    res.json({ success: true, data: { signature } });
  } catch (error: any) {
    console.error('Error sending recovery tx:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to send transaction' });
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
 * POST /build-approve-tx
 * Build a proposalApprove transaction for a given member.
 * Body: { memberAddress: string, multisigAddress: string, transactionIndex: number }
 */
router.post('/build-approve-tx', async (req: Request, res: Response) => {
  try {
    const { memberAddress, multisigAddress, transactionIndex: txIdx } = req.body;
    if (!memberAddress || !multisigAddress || txIdx == null) {
      res.status(400).json({ success: false, error: 'memberAddress, multisigAddress, transactionIndex are required' });
      return;
    }

    const multisigLib = await import('@sqds/multisig');
    const { Connection, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } = await import('@solana/web3.js');
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const conn = new Connection(rpcUrl);

    const multisigPda = new PublicKey(multisigAddress);
    const memberPubkey = new PublicKey(memberAddress);
    const transactionIndex = BigInt(txIdx);

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
        HeliusSender.createTipIx(memberPubkey),
      ],
    }).compileToV0Message();

    const tx = new VersionedTransaction(msg);
    const txBase64 = Buffer.from(tx.serialize()).toString('base64');

    res.json({ success: true, data: { transaction: txBase64, blockhash, lastValidBlockHeight } });
  } catch (error: any) {
    console.error('Error building approve tx:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to build approve transaction' });
  }
});

/**
 * POST /proposal/:proposalId/build-approve-tx
 * Build a proposalApprove transaction for a given member (by proposal ID).
 * @deprecated Use POST /build-approve-tx instead.
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
        HeliusSender.createTipIx(memberPubkey),
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
 * Build, sign, and send a proposalApprove TX using a server-owned Privy wallet.
 * Body: { walletAddress: string }
 */
router.post('/proposal/:proposalId/sign-privy', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.body;
    const address = walletAddress || '';
    if (!address) {
      res.status(400).json({ success: false, error: 'walletAddress is required' });
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
      res.status(400).json({ success: false, error: 'Privy wallet is not a required signer for this proposal' });
      return;
    }

    // Check if already signed
    const alreadySigned = proposal.collectedSignatures.some(s => s.address === address);
    if (alreadySigned) {
      res.json({ success: true, data: { status: proposal.status, signerAddress: address, alreadySigned: true } });
      return;
    }

    // Build approve TX
    const multisigLib = await import('@sqds/multisig');
    const { Connection, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } = await import('@solana/web3.js');
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const conn = new Connection(rpcUrl);

    const multisigPda = new PublicKey(proposal.multisigAddress);
    const memberPubkey = new PublicKey(address);
    const transactionIndex = BigInt(proposal.transactionIndex);

    const approveIx = multisigLib.instructions.proposalApprove({
      multisigPda,
      transactionIndex,
      member: memberPubkey,
    });

    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    const msg = new TransactionMessage({
      payerKey: memberPubkey,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
        approveIx,
        HeliusSender.createTipIx(memberPubkey),
      ],
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    const unsignedBase64 = Buffer.from(tx.serialize()).toString('base64');

    // Sign with Privy server-owned wallet
    const { signedTransaction } = await signTransactionWithPrivy(address, unsignedBase64);

    // Send on-chain via HeliusSender
    const signature = await HeliusSender.sendAndConfirm(signedTransaction);

    // Mark as signed in proposal
    proposal.collectedSignatures.push({
      address,
      signature,
      collectedAt: new Date(),
    });

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
        signerAddress: address,
      },
    });
  } catch (error: any) {
    console.error('Error signing with Privy:', error.message);
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

    // Send each transaction via HeliusSender SWQoS
    const signatures: string[] = [];
    for (const tx of transactions) {
      const sig = await HeliusSender.sendAndConfirm(tx);
      signatures.push(sig);
    }

    // Mark proposal as executed
    proposal.status = RecoveryProposalStatus.EXECUTED;
    proposal.executionSignature = signatures[0];
    await proposal.save();

    res.json({
      success: true,
      signatures,
      status: 'confirmed',
    });
  } catch (error: any) {
    console.error('Error sending recovery bundle:', error);
    res.status(500).json({ success: false, error: error?.message || 'Failed to send bundle' });
  }
});

/**
 * GET /proposal/:proposalId/build-execute-tx
 * Build a fresh execute transaction with a current blockhash.
 * TX1 (create + propose + approvals) is already on-chain.
 * This returns an unsigned TX2 for the mobile app to sign and send.
 */
router.get('/proposal/:proposalId/build-execute-tx', async (req: Request, res: Response) => {
  try {
    const proposal = await RecoveryProposalModel.findById(req.params.proposalId);
    if (!proposal) {
      res.status(404).json({ success: false, error: 'Proposal not found' });
      return;
    }

    if (proposal.status === RecoveryProposalStatus.EXECUTED) {
      res.status(400).json({ success: false, error: 'Already executed' });
      return;
    }

    if (proposal.status !== RecoveryProposalStatus.READY) {
      res.status(400).json({
        success: false,
        error: `Proposal is ${proposal.status}, need ${proposal.threshold - proposal.collectedSignatures.length} more signatures`,
      });
      return;
    }

    const multisigLib = await import('@sqds/multisig');
    const { Connection, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } = await import('@solana/web3.js');
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const conn = new Connection(rpcUrl, 'confirmed');

    const multisigPda = new PublicKey(proposal.multisigAddress);
    const transactionIndex = BigInt(proposal.transactionIndex);

    // Use the creator wallet (who initiated recovery) as payer/member
    const memberPubkey = new PublicKey(proposal.createdByWallet);

    // Check for rent collector
    const multisigAccount = await multisigLib.accounts.Multisig.fromAccountAddress(conn, multisigPda);

    const instructions = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
      multisigLib.instructions.configTransactionExecute({
        multisigPda,
        transactionIndex,
        member: memberPubkey,
        rentPayer: memberPubkey,
      }),
    ];

    if (multisigAccount.rentCollector) {
      instructions.push(multisigLib.instructions.configTransactionAccountsClose({
        multisigPda,
        transactionIndex,
        rentCollector: new PublicKey(multisigAccount.rentCollector),
      }));
    }

    // Helius SWQoS tip for reliable landing
    instructions.push(HeliusSender.createTipIx(memberPubkey));

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
    const msg = new TransactionMessage({
      payerKey: memberPubkey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);

    res.json({
      success: true,
      data: {
        transaction: Buffer.from(tx.serialize()).toString('base64'),
        blockhash,
        lastValidBlockHeight,
      },
    });
  } catch (error: any) {
    console.error('Error building execute tx:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to build execute transaction' });
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
