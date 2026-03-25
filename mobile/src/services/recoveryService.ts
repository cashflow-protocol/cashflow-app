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

  // Step 3: Ask backend to build TX1
  onProgress?.('Building recovery transaction...');

  const buildResult = await apiService.buildRecoveryProposalTx({
    multisigAddress,
    walletAddress,
    members,
    cloudKey: hasExistingCloud ? existingCloudKey! : undefined,
    addMemberActions: actions,
  });

  const { tx2Base64, transactionIndex, blockhash } = buildResult;

  // Step 4: Sign TX1 with cloud key + MWA, then send via backend
  onProgress?.('Signing with your wallet...');

  const tx1 = VersionedTransaction.deserialize(Buffer.from(buildResult.tx1Base64, 'base64'));

  // Sign with cloud key first (if it's an existing member)
  if (hasExistingCloud && existingCloudKey) {
    const cloudPubkey = new PublicKey(existingCloudKey);
    const msgBytes = tx1.message.serialize();
    const msgBase64 = Buffer.from(msgBytes).toString('base64');
    const cloudSig = await signWithCloud(msgBase64);
    const cloudSigBytes = new Uint8Array(Buffer.from(cloudSig, 'base64'));
    const cloudIdx = tx1.message.staticAccountKeys.findIndex(
      (k: PublicKey) => k.equals(cloudPubkey),
    );
    if (cloudIdx !== -1) {
      tx1.signatures[cloudIdx] = cloudSigBytes;
    }
  }

  // Sign with MWA wallet (sign-only)
  const tx1Serialized = new Uint8Array(tx1.serialize());
  const signedBytes = await walletService.signTransactions([tx1Serialized]);
  if (!signedBytes?.[0]) {
    throw new Error('Wallet signing failed');
  }

  // Send signed TX1 via backend (Helius SWQoS for reliable landing)
  onProgress?.('Sending proposal on-chain...');
  const signedTx1Base64 = Buffer.from(signedBytes[0]).toString('base64');
  const sendRes = await fetch(`${API_CONFIG.baseUrl}/vault-recovery/v1/send-recovery-tx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: signedTx1Base64 }),
  });
  if (!sendRes.ok) {
    const err = await sendRes.json().catch(() => ({ error: 'Failed' }));
    throw new Error(err.error || 'Failed to send recovery transaction');
  }

  onProgress?.('Proposal confirmed on-chain...');

  // Step 5: Determine required signers
  // Try local recovery emails first, then ask backend for Privy lookups
  const localEmails = await getRecoveryEmails();
  let privyEmails: Record<string, string> = {};
  try {
    const unknownAddresses = members
      .map(m => m.address)
      .filter(addr => addr !== walletAddress && addr !== existingCloudKey && !localEmails[addr]);
    if (unknownAddresses.length > 0) {
      const lookupRes = await fetch(`${API_CONFIG.baseUrl}/vault-recovery/v1/lookup-privy-emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses: unknownAddresses }),
      });
      if (lookupRes.ok) {
        const lookupData = await lookupRes.json();
        privyEmails = lookupData.data?.emails || {};
      }
    }
  } catch {}

  const allEmails = { ...localEmails, ...privyEmails };
  const requiredSigners: RecoveryMember[] = [];

  for (const member of members) {
    const addr = member.address;
    let type: RecoveryMember['type'];
    let label: string | undefined;
    let email: string | undefined;

    if (addr === walletAddress) {
      type = 'mwa';
      label = 'Seeker';
    } else if (hasExistingCloud && addr === existingCloudKey) {
      type = 'cloud';
      label = 'Cloud Key';
    } else if (allEmails[addr]) {
      type = 'privy';
      email = allEmails[addr];
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
    tx1Base64: buildResult.tx1Base64,
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
 * Execute the recovery proposal after threshold is met.
 *
 * TX1 (create + propose + approvals) is already confirmed on-chain.
 * This only needs to send a fresh execute transaction (TX2) signed by the
 * initiating wallet.
 */
export async function executeRecoveryProposal(
  proposalId: string,
  onProgress?: (msg: string) => void,
): Promise<string> {
  // Fetch a fresh execute TX from backend (new blockhash)
  onProgress?.('Building execute transaction...');

  const res = await fetch(
    `${API_CONFIG.baseUrl}/vault-recovery/v1/proposal/${proposalId}/build-execute-tx`,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed' }));
    throw new Error(err.error || 'Failed to build execute transaction');
  }
  const { data } = await res.json();
  const txBytes = Buffer.from(data.transaction, 'base64');
  const tx = VersionedTransaction.deserialize(txBytes);

  // Sign with MWA wallet
  onProgress?.('Signing execute transaction...');
  const serialized = new Uint8Array(tx.serialize());
  const signedBytes = await walletService.signTransactions([serialized]);
  if (!signedBytes?.[0]) {
    throw new Error('Wallet signing failed');
  }

  // Send signed execute TX via HeliusSender
  onProgress?.('Submitting execute transaction...');
  const signedBase64 = Buffer.from(signedBytes[0]).toString('base64');
  const sendRes = await fetch(
    `${API_CONFIG.baseUrl}/vault-recovery/v1/send-recovery-tx`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction: signedBase64 }),
    },
  );
  if (!sendRes.ok) {
    const err = await sendRes.json().catch(() => ({ error: 'Failed' }));
    throw new Error(err.error || 'Failed to send execute transaction');
  }

  const result = await sendRes.json();
  const txSignature = result.data?.signature || 'confirmed';

  // Mark proposal as executed
  await fetch(
    `${API_CONFIG.baseUrl}/vault-recovery/v1/proposal/${proposalId}/mark-executed`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature: txSignature }),
    },
  );

  onProgress?.('Confirming...');
  return txSignature;
}
