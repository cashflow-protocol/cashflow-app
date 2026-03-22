/**
 * Recovery Service — builds and orchestrates vault recovery transactions.
 *
 * Recovery adds new device/cloud keys to an existing Squads V4 multisig
 * by creating a config transaction signed by existing members.
 */
import {
  PublicKey,
  VersionedTransaction,
} from '@solana/web3.js';
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

function maskEmail(email: string): string {
  if (email.length <= 12) return email.slice(0, 2) + '...' + email.slice(-4);
  return email.slice(0, 2) + '...' + email.slice(-10);
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
  // Step 1: Generate new keys
  onProgress?.('Generating new keys...');
  const newDeviceKey = await generateAndStoreDeviceKeypair();

  let existingCloudKey = await getCloudPublicKey();
  let newCloudKey: string | null = null;
  const hasExistingCloud = existingCloudKey && members.some(m => m.address === existingCloudKey);

  if (!hasExistingCloud) {
    newCloudKey = await generateAndStoreCloudKeypair();
    existingCloudKey = newCloudKey;
  }

  // Step 2: Determine AddMember actions
  const actions: Array<{ memberAddress: string; permissions: string }> = [];
  actions.push({ memberAddress: newDeviceKey, permissions: 'all' });
  if (newCloudKey) {
    actions.push({ memberAddress: newCloudKey, permissions: 'all' });
  }

  // Step 3: Ask backend to build TX1 + TX2 with fresh blockhash
  onProgress?.('Building recovery transaction...');

  const buildResult = await apiService.buildRecoveryProposalTx({
    multisigAddress,
    walletAddress,
    members,
    cloudKey: hasExistingCloud ? existingCloudKey! : undefined,
    addMemberActions: actions,
  });

  const { tx1Base64, tx2Base64, transactionIndex, blockhash } = buildResult;

  // Step 4: Sign TX1 with cloud key + MWA, then send via backend
  onProgress?.('Signing with your wallet...');

  const tx1 = VersionedTransaction.deserialize(Buffer.from(tx1Base64, 'base64'));

  // Sign with cloud key if it's a member
  if (hasExistingCloud && existingCloudKey) {
    const existingCloudPubkey = new PublicKey(existingCloudKey);
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

  // Sign TX1 with MWA (sign-only)
  const tx1Serialized = new Uint8Array(tx1.serialize());
  const tx1SignedBytes = await walletService.signTransactions([tx1Serialized]);
  if (!tx1SignedBytes?.[0]) {
    throw new Error('Wallet signing failed — no signed transaction returned');
  }
  const tx1Signed = VersionedTransaction.deserialize(tx1SignedBytes[0]);
  const walletPubkey = new PublicKey(walletAddress);
  const tx1WalletIndex = tx1.message.staticAccountKeys.findIndex(
    (k: PublicKey) => k.equals(walletPubkey),
  );
  if (tx1WalletIndex !== -1) {
    tx1.signatures[tx1WalletIndex] = tx1Signed.signatures[tx1WalletIndex];
  }

  // Send TX1 via backend RPC
  onProgress?.('Sending proposal on-chain...');
  const signedTx1Base64 = Buffer.from(tx1.serialize()).toString('base64');
  await apiService.sendSignedRecoveryTx(signedTx1Base64);

  // Step 5: Determine required signers
  const recoveryEmails = await getRecoveryEmails();
  const requiredSigners: RecoveryMember[] = [];

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
  }

  // MWA + cloud key already signed TX1 on-chain, so mark them as signed
  const collectedSignatures: Array<{ address: string; signature: string }> = [];
  collectedSignatures.push({ address: walletAddress, signature: 'on-chain' });
  if (hasExistingCloud && existingCloudKey) {
    collectedSignatures.push({ address: existingCloudKey, signature: 'on-chain' });
  }

  // Step 6: Store proposal on backend
  onProgress?.('Saving recovery proposal...');

  const result = await apiService.createRecoveryProposal({
    multisigAddress,
    vaultAddress,
    transactionIndex,
    threshold,
    actions,
    tx1MessageBase64: '',
    tx1Base64: signedTx1Base64,
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
