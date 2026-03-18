import WebSocket from 'ws';
import { UserModel } from '../models';
import { dispatchOnchainNotification } from './notificationService';
import type { HeliusEnhancedTransaction } from './transactionParser';

let ws: WebSocket | null = null;
let apiKey: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// Track vault addresses we want to subscribe to
const vaultAddresses = new Set<string>();

// Map JSON-RPC request IDs to vault addresses (for matching subscribe responses)
const pendingSubscriptions = new Map<number, string>();

// Map subscription IDs to vault addresses (for matching notifications)
const subscriptionToVault = new Map<number, string>();

// Track recently processed signatures to avoid duplicate notifications
const recentSignatures = new Set<string>();
const MAX_RECENT_SIGNATURES = 500;

let nextRequestId = 1;

export async function initializeHeliusListener(): Promise<void> {
  apiKey = process.env.HELIUS_API_KEY || null;
  if (!apiKey) {
    console.warn('⚠️ HELIUS_API_KEY not set, onchain notification listener disabled');
    return;
  }

  // Load all existing users' vault addresses
  const users = await UserModel.find({}).select('vaultAddress').lean();
  for (const user of users) {
    vaultAddresses.add(user.vaultAddress);
  }

  console.log(`📡 Helius listener: subscribing to ${vaultAddresses.size} vault addresses`);
  connect();
}

export function subscribeToVault(vaultAddress: string): void {
  if (vaultAddresses.has(vaultAddress)) return;
  vaultAddresses.add(vaultAddress);

  if (ws?.readyState === WebSocket.OPEN) {
    sendSubscribeMessage(vaultAddress);
  }
}

function connect(): void {
  if (!apiKey) return;

  // Use standard Solana RPC WebSocket (available on all Helius plans)
  ws = new WebSocket(`wss://mainnet.helius-rpc.com?api-key=${apiKey}`);

  ws.on('open', () => {
    console.log(`✅ Helius WebSocket connected, subscribing to ${vaultAddresses.size} vaults`);
    // Subscribe to all tracked vault addresses
    for (const vaultAddress of vaultAddresses) {
      sendSubscribeMessage(vaultAddress);
    }
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleMessage(message);
    } catch (error) {
      console.error('Helius WS message parse error:', error);
    }
  });

  ws.on('close', (code, reason) => {
    console.warn(`⚠️ Helius WebSocket closed (${code}), reconnecting in 5s...`);
    subscriptionToVault.clear();
    pendingSubscriptions.clear();
    scheduleReconnect();
  });

  ws.on('error', (error) => {
    console.error('Helius WS error:', error);
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 5000);
}

function sendSubscribeMessage(vaultAddress: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const requestId = nextRequestId++;
  pendingSubscriptions.set(requestId, vaultAddress);

  // Use logsSubscribe with "mentions" filter — fires for ANY transaction
  // that includes this address in its account list (SOL + SPL tokens)
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    id: requestId,
    method: 'logsSubscribe',
    params: [
      { mentions: [vaultAddress] },
      { commitment: 'confirmed' },
    ],
  }));
}

function handleMessage(message: any): void {
  // Handle subscription confirmation response
  if (message.id && message.result !== undefined) {
    const vaultAddress = pendingSubscriptions.get(message.id);
    if (vaultAddress) {
      pendingSubscriptions.delete(message.id);
      subscriptionToVault.set(message.result, vaultAddress);
      console.log(`📡 Subscribed to ${vaultAddress.slice(0, 8)}... (sub=${message.result})`);
    }
    return;
  }

  // Handle errors from subscription requests
  if (message.id && message.error) {
    const vaultAddress = pendingSubscriptions.get(message.id);
    console.error(`❌ Subscription failed for ${vaultAddress?.slice(0, 8) ?? 'unknown'}:`, message.error);
    if (vaultAddress) pendingSubscriptions.delete(message.id);
    return;
  }

  // Handle log notification (fires for any tx mentioning the vault address)
  if (message.method === 'logsNotification' && message.params) {
    const subscriptionId = message.params.subscription;
    const vaultAddress = subscriptionToVault.get(subscriptionId);
    if (!vaultAddress) return;

    // Skip failed transactions
    const err = message.params.result?.value?.err;
    if (err) return;

    const signature = message.params.result?.value?.signature;
    if (!signature || recentSignatures.has(signature)) return;

    console.log(`🔔 Transaction detected for ${vaultAddress.slice(0, 8)}... (${signature.slice(0, 8)}...)`);

    // Fetch enhanced transaction details and dispatch notification
    fetchAndDispatchTransaction(vaultAddress, signature).catch((error) => {
      console.error('Transaction fetch/dispatch error:', error);
    });
  }
}

/**
 * Fetch a single transaction by signature using the Helius enhanced
 * transactions API, then dispatch a notification.
 */
async function fetchAndDispatchTransaction(vaultAddress: string, signature: string): Promise<void> {
  if (!apiKey) return;

  // Mark as processed immediately to avoid duplicates from rapid notifications
  recentSignatures.add(signature);
  if (recentSignatures.size > MAX_RECENT_SIGNATURES) {
    const first = recentSignatures.values().next().value;
    if (first) recentSignatures.delete(first);
  }

  // Small delay to let the transaction finalize on RPC
  await new Promise((r) => setTimeout(r, 1500));

  const txResponse = await fetch(
    `https://api.helius.xyz/v0/transactions?api-key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: [signature] }),
    },
  );

  if (!txResponse.ok) {
    console.error(`❌ Helius enhanced API error: ${txResponse.status} ${txResponse.statusText}`);
    return;
  }

  const enhancedTxs = await txResponse.json() as HeliusEnhancedTransaction[];
  if (!Array.isArray(enhancedTxs) || enhancedTxs.length === 0) return;

  const tx = enhancedTxs[0];
  if (!tx?.signature) return;

  dispatchOnchainNotification(vaultAddress, tx).catch((error: any) => {
    console.error('Notification dispatch error:', error);
  });
}
