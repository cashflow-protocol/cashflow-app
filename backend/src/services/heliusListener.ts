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

  // Use standard accountSubscribe — available on all Helius plans
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    id: requestId,
    method: 'accountSubscribe',
    params: [
      vaultAddress,
      { encoding: 'jsonParsed', commitment: 'confirmed' },
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

  // Handle account change notification
  if (message.method === 'accountNotification' && message.params) {
    const subscriptionId = message.params.subscription;
    const vaultAddress = subscriptionToVault.get(subscriptionId);
    if (!vaultAddress) return;

    console.log(`🔔 Account change detected for ${vaultAddress.slice(0, 8)}...`);

    // Account changed — fetch recent transactions via Helius enhanced API
    fetchAndDispatchTransactions(vaultAddress).catch((error) => {
      console.error('Transaction fetch/dispatch error:', error);
    });
  }
}

/**
 * Fetch recent transactions for a vault address using the Helius enhanced
 * transactions API, then dispatch notifications for any new ones.
 */
async function fetchAndDispatchTransactions(vaultAddress: string): Promise<void> {
  if (!apiKey) return;

  // Small delay to let the transaction finalize on RPC
  await new Promise((r) => setTimeout(r, 1500));

  // Step 1: Get recent transaction signatures for this account
  const sigResponse = await fetch(
    `https://mainnet.helius-rpc.com/?api-key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAddress',
        params: [vaultAddress, { limit: 3, commitment: 'confirmed' }],
      }),
    },
  );
  const sigData = await sigResponse.json() as any;
  if (sigData.error) {
    console.error(`❌ getSignaturesForAddress error for ${vaultAddress.slice(0, 8)}...:`, sigData.error);
    return;
  }
  const signatures: string[] = (sigData.result || [])
    .filter((s: any) => !s.err)
    .map((s: any) => s.signature);

  console.log(`📋 ${vaultAddress.slice(0, 8)}...: ${signatures.length} recent sigs, ${recentSignatures.size} already processed`);

  if (signatures.length === 0) return;

  // Filter out already-processed signatures
  const newSignatures = signatures.filter((sig) => !recentSignatures.has(sig));
  if (newSignatures.length === 0) {
    console.log(`📋 ${vaultAddress.slice(0, 8)}...: all signatures already processed`);
    return;
  }

  console.log(`📋 ${vaultAddress.slice(0, 8)}...: fetching ${newSignatures.length} new tx(s) from Helius`);

  // Step 2: Fetch enhanced transaction details from Helius
  const txResponse = await fetch(
    `https://api.helius.xyz/v0/transactions?api-key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: newSignatures }),
    },
  );

  if (!txResponse.ok) {
    console.error(`❌ Helius enhanced API error: ${txResponse.status} ${txResponse.statusText}`);
    const body = await txResponse.text().catch(() => '');
    if (body) console.error(`   Response: ${body.slice(0, 200)}`);
    return;
  }

  const enhancedTxs = await txResponse.json() as HeliusEnhancedTransaction[];

  if (!Array.isArray(enhancedTxs)) {
    console.error('❌ Helius enhanced API returned non-array:', typeof enhancedTxs);
    return;
  }

  console.log(`📋 ${vaultAddress.slice(0, 8)}...: got ${enhancedTxs.length} enhanced tx(s)`);

  // Mark as processed and dispatch
  for (const tx of enhancedTxs) {
    if (!tx?.signature) continue;

    recentSignatures.add(tx.signature);
    // Evict old entries to prevent memory growth
    if (recentSignatures.size > MAX_RECENT_SIGNATURES) {
      const first = recentSignatures.values().next().value;
      if (first) recentSignatures.delete(first);
    }

    console.log(`📨 Dispatching notification for ${tx.signature.slice(0, 8)}... (type=${tx.type}, source=${tx.source})`);
    console.log(`   nativeTransfers=${JSON.stringify(tx.nativeTransfers?.slice(0, 3))}`);
    console.log(`   tokenTransfers=${JSON.stringify(tx.tokenTransfers?.slice(0, 3))}`);
    dispatchOnchainNotification(vaultAddress, tx).catch((error) => {
      console.error('Notification dispatch error:', error);
    });
  }
}
