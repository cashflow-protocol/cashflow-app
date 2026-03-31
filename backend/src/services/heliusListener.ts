import { UserModel } from '../models';
import { dispatchOnchainNotification } from './notificationService';
import type { HeliusEnhancedTransaction } from './transactionParser';

let apiKey: string | null = null;
let webhookId: string | null = null;
let webhookSecret: string | null = null;
const vaultAddresses = new Set<string>();

function getWebhookUrl(): string {
  const base = process.env.WEBHOOK_BASE_URL || 'https://api-dev.cashflow.fun';
  return `${base}/helius/webhook`;
}

export async function initializeHeliusListener(): Promise<void> {
  apiKey = process.env.HELIUS_API_KEY || null;
  webhookSecret = process.env.HELIUS_WEBHOOK_SECRET || null;

  if (!apiKey) {
    console.warn('⚠️ HELIUS_API_KEY not set, onchain notification listener disabled');
    return;
  }
  if (!webhookSecret) {
    console.warn('⚠️ HELIUS_WEBHOOK_SECRET not set, onchain notification listener disabled');
    return;
  }

  // Load all vault addresses
  const users = await UserModel.find({}).select('vaultAddress').lean();
  for (const user of users) {
    vaultAddresses.add(user.vaultAddress);
  }

  const webhookUrl = getWebhookUrl();
  console.log(`📡 Helius webhook: ${vaultAddresses.size} vaults, URL: ${webhookUrl}`);

  try {
    // List existing webhooks
    const listRes = await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${apiKey}`);
    if (!listRes.ok) {
      console.error(`❌ Failed to list Helius webhooks: ${listRes.status}`);
      return;
    }

    const webhooks = await listRes.json() as Array<{
      webhookID: string;
      webhookURL: string;
      accountAddresses: string[];
    }>;

    // Find our webhook by URL
    const existing = webhooks.find((w) => w.webhookURL === webhookUrl);

    if (existing) {
      webhookId = existing.webhookID;

      // Check if address list needs updating
      const existingSet = new Set(existing.accountAddresses);
      const needsUpdate = vaultAddresses.size !== existingSet.size ||
        [...vaultAddresses].some((a) => !existingSet.has(a));

      if (needsUpdate) {
        await updateWebhookAddresses();
        console.log(`✅ Helius webhook updated (id: ${webhookId})`);
      } else {
        console.log(`✅ Helius webhook in sync (id: ${webhookId})`);
      }
    } else {
      // Create new webhook
      const createRes = await fetch(`https://api.helius.xyz/v0/webhooks?api-key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookURL: webhookUrl,
          transactionTypes: ['Any'],
          accountAddresses: [...vaultAddresses],
          webhookType: 'enhanced',
          authHeader: webhookSecret,
        }),
      });

      if (!createRes.ok) {
        const err = await createRes.text();
        console.error(`❌ Failed to create Helius webhook: ${createRes.status} ${err}`);
        return;
      }

      const created = await createRes.json() as { webhookID: string };
      webhookId = created.webhookID;
      console.log(`✅ Helius webhook created (id: ${webhookId})`);
    }
  } catch (error) {
    console.error('❌ Helius webhook setup error:', error);
  }
}

/**
 * Add a new vault address to the webhook. Called when a new user registers.
 */
export async function subscribeToVault(vaultAddress: string): Promise<void> {
  if (vaultAddresses.has(vaultAddress)) return;
  vaultAddresses.add(vaultAddress);

  if (!apiKey || !webhookId) return;

  try {
    await updateWebhookAddresses();
    console.log(`📡 Webhook updated: added ${vaultAddress.slice(0, 8)}... (${vaultAddresses.size} total)`);
  } catch (error) {
    console.error(`Failed to add vault to webhook: ${error}`);
  }
}

async function updateWebhookAddresses(): Promise<void> {
  const res = await fetch(`https://api.helius.xyz/v0/webhooks/${webhookId}?api-key=${apiKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      webhookURL: getWebhookUrl(),
      transactionTypes: ['Any'],
      accountAddresses: [...vaultAddresses],
      webhookType: 'enhanced',
      authHeader: webhookSecret,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Helius webhook update failed: ${res.status} ${err}`);
  }
}

/**
 * Verify the auth header on an incoming webhook request.
 */
export function verifyWebhookAuth(authHeader: string | undefined): boolean {
  if (!webhookSecret || !authHeader) return false;
  if (authHeader.length !== webhookSecret.length) return false;
  const { timingSafeEqual } = require('crypto');
  return timingSafeEqual(Buffer.from(authHeader), Buffer.from(webhookSecret));
}

/**
 * Process an incoming webhook payload (array of enhanced transactions).
 */
export async function handleWebhookPayload(transactions: HeliusEnhancedTransaction[]): Promise<void> {
  for (const tx of transactions) {
    if (!tx?.signature) continue;

    // Determine which vault(s) this transaction belongs to
    const matchedVaults = new Set<string>();

    for (const transfer of tx.tokenTransfers || []) {
      if (vaultAddresses.has(transfer.toUserAccount)) matchedVaults.add(transfer.toUserAccount);
      if (vaultAddresses.has(transfer.fromUserAccount)) matchedVaults.add(transfer.fromUserAccount);
    }

    for (const transfer of tx.nativeTransfers || []) {
      if (vaultAddresses.has(transfer.toUserAccount)) matchedVaults.add(transfer.toUserAccount);
      if (vaultAddresses.has(transfer.fromUserAccount)) matchedVaults.add(transfer.fromUserAccount);
    }

    for (const vault of matchedVaults) {
      try {
        await dispatchOnchainNotification(vault, tx);
      } catch (err: any) {
        if (err?.code !== 11000) {
          console.error('Notification dispatch error:', err);
        }
      }
    }
  }
}
