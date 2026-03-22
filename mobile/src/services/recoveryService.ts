/**
 * Recovery Service — builds and orchestrates vault recovery transactions.
 *
 * Recovery adds new device/cloud keys to an existing Squads V4 multisig
 * by creating a config transaction signed by existing members.
 */
import {
  Connection,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { SOLANA_CONFIG } from '../config/solana';
import { API_CONFIG } from '../config/api';
import {
  generateAndStoreCloudKeypair,
  generateAndStoreDeviceKeypair,
  getCloudPublicKey,
  signWithCloud,
} from './keypairStorage';
import walletService from './walletService';
import apiService from './apiService';
import { getRecoveryEmails } from './vaultStorage';

const { Permission, Permissions } = multisig.types;

function maskEmail(email: string): string {
  if (email.length <= 12) return email.slice(0, 2) + '...' + email.slice(-4);
  return email.slice(0, 2) + '...' + email.slice(-10);
}
const connection = new Connection(SOLANA_CONFIG.rpcEndpoint, SOLANA_CONFIG.commitment);

// Jito tip
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
const JITO_TIP_LAMPORTS = 500_000;

function jitoTipIx(feePayer: PublicKey): TransactionInstruction {
  const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
  return SystemProgram.transfer({
    fromPubkey: feePayer,
    toPubkey: new PublicKey(tipAccount),
    lamports: JITO_TIP_LAMPORTS,
  });
}

export interface RecoveryMember {
  address: string;
  type: 'mwa' | 'cloud' | 'privy' | 'external';
  label?: string;
  email?: string;
}

export interface RecoveryProposalResult {
  proposalId: string;
  status: string;
  signaturesCollected: number;
  signaturesRequired: number;
  newDeviceKey: string;
  newCloudKey: string | null;
  externalSigningUrl: string | null;
}

/**
 * Build and submit a recovery proposal.
 *
 * 1. Generate new keys (device always, cloud if missing)
 * 2. Build config TX to add new keys as members
 * 3. Sign locally with available signers (MWA, cloud if exists)
 * 4. Submit proposal to backend for multi-party signing
 */
export async function buildAndSubmitRecoveryProposal(
  multisigAddress: string,
  vaultAddress: string,
  walletAddress: string,
  members: Array<{ address: string; permissions: { initiate: boolean; vote: boolean; execute: boolean } }>,
  threshold: number,
  onProgress?: (msg: string) => void,
): Promise<RecoveryProposalResult> {
  const multisigPda = new PublicKey(multisigAddress);
  const walletPubkey = new PublicKey(walletAddress);

  // Step 1: Generate new keys
  onProgress?.('Generating new keys...');
  const newDeviceKey = await generateAndStoreDeviceKeypair();
  const newDevicePubkey = new PublicKey(newDeviceKey);

  let existingCloudKey = await getCloudPublicKey();
  let newCloudKey: string | null = null;
  const hasExistingCloud = existingCloudKey && members.some(m => m.address === existingCloudKey);

  if (!hasExistingCloud) {
    newCloudKey = await generateAndStoreCloudKeypair();
    existingCloudKey = newCloudKey;
  }

  // Step 2: Determine AddMember actions
  const actions: Array<{ memberAddress: string; permissions: string }> = [];
  const addMemberActions: any[] = [];

  // Always add new device key
  actions.push({ memberAddress: newDeviceKey, permissions: 'all' });
  addMemberActions.push({
    __kind: 'AddMember' as const,
    newMember: { key: newDevicePubkey, permissions: Permissions.all() },
  });

  // Add new cloud key if generated
  if (newCloudKey) {
    const newCloudPubkey = new PublicKey(newCloudKey);
    actions.push({ memberAddress: newCloudKey, permissions: 'all' });
    addMemberActions.push({
      __kind: 'AddMember' as const,
      newMember: { key: newCloudPubkey, permissions: Permissions.all() },
    });
  }

  // Step 3: Build TX1 — config transaction + proposal + approvals from available signers
  onProgress?.('Building recovery transaction...');

  const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  const transactionIndex = BigInt(multisigAccount.transactionIndex.toString()) + 1n;

  // MWA wallet is the fee payer (cloud key may not have SOL during recovery)
  const feePayer = walletPubkey;

  // Determine which existing members can sign
  const existingCloudPubkey = hasExistingCloud ? new PublicKey(existingCloudKey!) : null;

  // Build instructions
  const tx1Instructions: TransactionInstruction[] = [];

  // Create config transaction with all AddMember actions
  tx1Instructions.push(multisig.instructions.configTransactionCreate({
    multisigPda,
    transactionIndex,
    creator: walletPubkey,
    rentPayer: feePayer,
    actions: addMemberActions,
  }));

  // Create proposal
  tx1Instructions.push(multisig.instructions.proposalCreate({
    multisigPda,
    transactionIndex,
    creator: walletPubkey,
    rentPayer: feePayer,
  }));

  // MWA wallet approves
  tx1Instructions.push(multisig.instructions.proposalApprove({
    multisigPda,
    transactionIndex,
    member: walletPubkey,
  }));

  // Cloud key approves (if we have the existing cloud key)
  if (existingCloudPubkey) {
    tx1Instructions.push(multisig.instructions.proposalApprove({
      multisigPda,
      transactionIndex,
      member: existingCloudPubkey,
    }));
  }

  // Build TX2 — execute + close + Jito tip
  const tx2Instructions: TransactionInstruction[] = [];
  tx2Instructions.push(multisig.instructions.configTransactionExecute({
    multisigPda,
    transactionIndex,
    member: walletPubkey,
    rentPayer: feePayer,
  }));

  if (multisigAccount.rentCollector) {
    tx2Instructions.push(multisig.instructions.configTransactionAccountsClose({
      multisigPda,
      transactionIndex,
      rentCollector: new PublicKey(multisigAccount.rentCollector),
    }));
  }
  tx2Instructions.push(jitoTipIx(feePayer));

  // Compile transactions
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  const msg1 = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions: tx1Instructions,
  }).compileToV0Message();
  const tx1 = new VersionedTransaction(msg1);

  const msg2 = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions: tx2Instructions,
  }).compileToV0Message();
  const tx2 = new VersionedTransaction(msg2);

  // Step 4: Sign locally
  onProgress?.('Signing with your wallet...');

  // Sign with existing cloud key if available
  if (existingCloudPubkey) {
    const messageBytes = tx1.message.serialize();
    const messageBase64 = Buffer.from(messageBytes).toString('base64');
    const sigBase64 = await signWithCloud(messageBase64);
    const sigBytes = new Uint8Array(Buffer.from(sigBase64, 'base64'));

    const cloudIndex = tx1.message.staticAccountKeys.findIndex(
      (k: PublicKey) => k.equals(existingCloudPubkey),
    );
    if (cloudIndex !== -1) {
      tx1.signatures[cloudIndex] = sigBytes;
    }
  }

  // Sign TX1 and TX2 with MWA wallet
  const serialized = [tx1, tx2].map(tx => new Uint8Array(tx.serialize()));
  const signedBytes = await walletService.signTransactions(serialized);
  if (!signedBytes || signedBytes.length < 2) {
    throw new Error('Wallet signing failed — no signed transactions returned');
  }

  // Extract MWA signatures and apply to both transactions
  for (let i = 0; i < 2; i++) {
    const originalTx = [tx1, tx2][i];
    const signedTx = VersionedTransaction.deserialize(signedBytes[i]);
    const walletIndex = originalTx.message.staticAccountKeys.findIndex(
      (k: PublicKey) => k.equals(walletPubkey),
    );
    if (walletIndex !== -1) {
      originalTx.signatures[walletIndex] = signedTx.signatures[walletIndex];
    }
  }

  // Step 5: Determine required signers and who has already signed
  const recoveryEmails = await getRecoveryEmails();
  const requiredSigners: RecoveryMember[] = [];
  const collectedSignatures: Array<{ address: string; signature: string }> = [];

  for (const member of members) {
    const addr = member.address;
    let type: RecoveryMember['type'];
    let label: string | undefined;
    let email: string | undefined;

    if (addr === walletAddress) {
      type = 'mwa';
      label = 'Connected Wallet';
    } else if (hasExistingCloud && addr === existingCloudKey) {
      type = 'cloud';
      label = 'Cloud Key';
    } else if (recoveryEmails[addr]) {
      type = 'privy';
      email = recoveryEmails[addr];
      label = `Email (${maskEmail(email)})`;
    } else {
      type = 'external';
      label = 'External Wallet';
    }

    requiredSigners.push({ address: addr, type, label, email });

    // Extract collected signatures from signed tx
    const signerIndex = tx1.message.staticAccountKeys.findIndex(
      (k: PublicKey) => k.equals(new PublicKey(addr)),
    );
    if (signerIndex !== -1) {
      const sig = tx1.signatures[signerIndex];
      const isNonZero = sig.some((b: number) => b !== 0);
      if (isNonZero) {
        collectedSignatures.push({
          address: addr,
          signature: Buffer.from(sig).toString('base64'),
        });
      }
    }
  }

  // Step 6: Submit to backend — it will broadcast TX1 on-chain and store the proposal
  onProgress?.('Sending proposal on-chain...');

  const tx1Base64 = Buffer.from(tx1Bytes).toString('base64');
  const tx2Base64 = Buffer.from(tx2.serialize()).toString('base64');
  const tx1MessageBase64 = Buffer.from(tx1.message.serialize()).toString('base64');

  const result = await apiService.createRecoveryProposal({
    multisigAddress,
    vaultAddress,
    transactionIndex: Number(transactionIndex),
    threshold,
    actions,
    tx1MessageBase64,
    tx1Base64,
    tx2Base64,
    blockhash,
    requiredSigners,
    collectedSignatures,
    createdByWallet: walletAddress,
  });

  // Build external signing URL
  const hasExternalSigners = requiredSigners.some(s => s.type === 'external');
  const externalSigningUrl = hasExternalSigners
    ? `${API_CONFIG.websiteUrl}/recovery/${result.proposalId}`
    : null;

  return {
    ...result,
    newDeviceKey,
    newCloudKey,
    externalSigningUrl,
  };
}

/**
 * Assemble and submit the recovery transaction bundle after threshold is met.
 */
export async function executeRecoveryProposal(
  proposalId: string,
  onProgress?: (msg: string) => void,
): Promise<string> {
  onProgress?.('Fetching signed transactions...');

  const { tx1Base64, tx2Base64, signatures } = await apiService.getAssembledRecoveryTx(proposalId);

  // Deserialize transactions
  const tx1 = VersionedTransaction.deserialize(Buffer.from(tx1Base64, 'base64'));
  const tx2 = VersionedTransaction.deserialize(Buffer.from(tx2Base64, 'base64'));

  // Insert collected signatures into TX1
  for (const { address, signature } of signatures) {
    const pubkey = new PublicKey(address);
    const sigIndex = tx1.message.staticAccountKeys.findIndex(
      (k: PublicKey) => k.equals(pubkey),
    );
    if (sigIndex !== -1) {
      const existingSig = tx1.signatures[sigIndex];
      const isZero = existingSig.every((b: number) => b === 0);
      if (isZero) {
        tx1.signatures[sigIndex] = new Uint8Array(Buffer.from(signature, 'base64'));
      }
    }
  }

  // Send as Jito bundle via unauthenticated recovery endpoint
  onProgress?.('Submitting recovery transaction...');
  const bundleTx1 = Buffer.from(tx1.serialize()).toString('base64');
  const bundleTx2 = Buffer.from(tx2.serialize()).toString('base64');

  const bundleResult = await apiService.sendRecoveryBundle(proposalId, [bundleTx1, bundleTx2]);

  onProgress?.('Confirming...');
  return bundleResult.bundleId;
}
