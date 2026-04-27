import { API_CONFIG } from '../config/api';
import { BUILD_NUMBER } from '../config/version';
import type { EarnToken, EarnPosition, WalletAsset, Suggestion } from '../types/earn';
import type { AppNotification } from '../types/notification';
import type { TaskWithProgress } from '../types/rewards';
import authService from './authService';
import { verifyResponseSignature } from './responseVerifier';

export interface SerializedInstruction {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string; // base64-encoded
}

const JITO_TIP_FALLBACK_LAMPORTS = 500_000;
const JITO_TIP_CACHE_MS = 15_000;

class ApiService {
  private baseUrl = API_CONFIG.baseUrl;
  private jitoTipCache: { lamports: number; fetchedAt: number } | null = null;

  /**
   * Fetch the current Jito tip (dynamic from backend, cached 15s).
   * Falls back to 500k lamports on error.
   */
  async getJitoTipLamports(): Promise<number> {
    const now = Date.now();
    if (this.jitoTipCache && now - this.jitoTipCache.fetchedAt < JITO_TIP_CACHE_MS) {
      return this.jitoTipCache.lamports;
    }
    try {
      const r = await fetch(`${this.baseUrl}/solana/v1/jito-tip`);
      if (!r.ok) throw new Error(`API error: ${r.status}`);
      const res = await r.json();
      const lamports = Number(res.lamports);
      if (!Number.isFinite(lamports) || lamports <= 0) throw new Error('Invalid tip response');
      this.jitoTipCache = { lamports, fetchedAt: now };
      return lamports;
    } catch (err) {
      console.warn('[apiService] jito-tip fetch failed, using fallback:', err);
      return JITO_TIP_FALLBACK_LAMPORTS;
    }
  }

  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    const token = await authService.getToken();
    const res = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.status === 401) {
      authService.clearToken();
      const newToken = await authService.getToken();
      const retry = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${newToken}` },
      });
      if (!retry.ok) throw new Error(`API error: ${retry.status}`);
      return retry.json();
    }
    if (!res.ok) {
      throw new Error(`API error: ${res.status}`);
    }
    return res.json();
  }

  async getConfig(): Promise<{
    lookupTableAddress: string | null;
    solanaRpcUrl: string | null;
    treasuryWallet: string | null;
    vaultCreationFee: number | null;
    supportUrl: string | null;
    adminTxFeePayerPublicKey: string | null;
    rewardsCollectionAddress: string | null;
    rewardsBadgeMintFeeLamports: number | null;
  }> {
    // Config is needed during vault creation (before auth is available) — bypass auth
    const r = await fetch(`${this.baseUrl}/config/v1`);
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    const res = await r.json();
    return res.data;
  }

  async recordVaultCreationFee(vaultAddress: string, feeAmount: string, signature: string): Promise<void> {
    // Bypass auth — vault creation happens before login
    const r = await fetch(`${this.baseUrl}/config/v1/vault-creation-fee`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vaultAddress, feeAmount, signature }),
    });
    if (!r.ok) console.warn('Failed to record vault creation fee:', r.status);
  }

  /**
   * Create a Squads vault via the backend.
   * - Standard mode: backend signs + sends, returns txSignature.
   * - Seeker/android_gms: backend returns partially-signed tx for MWA signing.
   * Bypasses auth — vault creation happens before login.
   */
  async createVault(params: {
    paymentId: string;
    platform: 'ios' | 'android';
    mode: 'standard' | 'seeker' | 'android_gms';
    deviceKey: string;
    cloudKey?: string;
    walletAddress?: string;
  }): Promise<{
    multisigAddress: string;
    vaultAddress: string;
    txSignature?: string;
    serializedTx?: string;
    serializedTxs?: string[];
  }> {
    const r = await fetch(`${this.baseUrl}/onboarding/v1/create-vault`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const text = await r.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Server returned non-JSON response (${r.status}). Please try again later.`);
    }
    if (!r.ok || !json.success) {
      throw new Error(json.error || `Failed to create vault: ${r.status}`);
    }
    return json.data;
  }

  /**
   * Confirm vault creation after MWA signing (Seeker/android_gms mode).
   * Bypasses auth — vault creation happens before login.
   */
  async confirmVault(paymentId: string, txSignature: string): Promise<void> {
    const r = await fetch(`${this.baseUrl}/onboarding/v1/confirm-vault`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId, txSignature }),
    });
    const json = await r.json();
    if (!r.ok || !json.success) {
      throw new Error(json.error || `Failed to confirm vault: ${r.status}`);
    }
  }

  async getEarnTokens(): Promise<EarnToken[]> {
    const res = await this.get<{ success: boolean; data: EarnToken[] }>('/earn/v2/tokens', { buildNumber: BUILD_NUMBER });
    return res.data;
  }

  async getWalletBalance(walletAddress: string, mint: string): Promise<{ amount: string; uiAmount: number }> {
    const res = await this.get<{ success: boolean; data: { mint: string; amount: string; uiAmount: number } }>(
      '/solana/v2/wallet-balance',
      { walletAddress, mint },
    );
    return { amount: res.data.amount, uiAmount: res.data.uiAmount };
  }

  async getEmptyTokenAccounts(walletAddress: string): Promise<{ total: number; empty: number }> {
    const res = await this.get<{ success: boolean; data: { total: number; empty: number } }>(
      '/solana/v2/empty-token-accounts',
      { walletAddress },
    );
    return res.data;
  }

  async getAssets(walletAddress: string): Promise<{ totalUsdValue: number; assets: WalletAsset[] }> {
    const res = await this.get<{
      success: boolean;
      data: { totalUsdValue: number; assets: WalletAsset[] };
    }>('/solana/v2/assets', { walletAddress });
    return res.data;
  }

  async getPositions(walletAddress: string): Promise<EarnPosition[]> {
    const res = await this.get<{ success: boolean; data: EarnPosition[] }>('/earn/v2/positions', {
      walletAddress,
    });
    return res.data;
  }

  async getEarnings(walletAddress: string): Promise<{
    lifetimeEarnedUsd: number;
    perMint: { mint: string; symbol: string; earningsUsd: number }[];
  }> {
    const res = await this.get<{
      success: boolean;
      data: { lifetimeEarnedUsd: number; perMint: { mint: string; symbol: string; earningsUsd: number }[] };
    }>('/earn/v2/earnings', { walletAddress });
    return res.data;
  }

  async getFeePreview(vaultAddress: string, mint: string, amount: string): Promise<{
    feeAmount: string;
    profitAmount: string;
    feeUiAmount: number;
    profitUiAmount: number;
  }> {
    const res = await this.get<{
      success: boolean;
      data: { feeAmount: string; profitAmount: string; feeUiAmount: number; profitUiAmount: number };
    }>('/earn/v2/fee-preview', { vaultAddress, mint, amount });
    return res.data;
  }

  private async post<T>(path: string, body: Record<string, any>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const token = await authService.getToken();
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      authService.clearToken();
      const newToken = await authService.getToken();
      const retry = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${newToken}` },
        body: JSON.stringify(body),
      });
      if (!retry.ok) {
        const errorBody = await retry.json().catch(() => ({}));
        throw new Error(errorBody.error || `API error: ${retry.status}`);
      }
      return retry.json();
    }
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      throw new Error(errorBody.error || `API error: ${res.status}`);
    }
    return res.json();
  }

  /** Like post(), but verifies the Ed25519 response signature to detect MITM tampering. */
  private async signedPost<T>(path: string, body: Record<string, any>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const token = await authService.getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

    let res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      authService.clearToken();
      const newToken = await authService.getToken();
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${newToken}` },
        body: JSON.stringify(body),
      });
    }

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      throw new Error(errorBody.error || `API error: ${res.status}`);
    }

    const rawText = await res.text();
    const signature = res.headers.get('X-Response-Signature');

    const valid = await verifyResponseSignature(rawText, signature);
    if (!valid) {
      throw new Error('Response integrity check failed');
    }

    return JSON.parse(rawText) as T;
  }

  async debugLog(tag: string, lines: string[]): Promise<void> {
    // Debug log is an unauthenticated inline route — bypass auth
    await fetch(`${this.baseUrl}/debug/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag, lines }),
    });
  }

  async notifyInterest(protocol: string, protocolName: string): Promise<void> {
    await this.post<{ success: boolean }>('/earn/v2/notify-interest', { protocol, protocolName });
  }

  async getRewardTasks(): Promise<{
    tasks: TaskWithProgress[];
    cashflowPassport: {
      address: string | null;
      activated: boolean;
      activatedAt: string | null;
      feeLamports: string;
    };
  }> {
    const res = await this.get<{
      success: boolean;
      data: {
        tasks: TaskWithProgress[];
        cashflowPassport: {
          address: string | null;
          activated: boolean;
          activatedAt: string | null;
          feeLamports: string;
        };
      };
    }>('/rewards/v2/tasks');
    return res.data;
  }

  async getSeekerAttestChallenge(walletAddress: string): Promise<{ challenge: string; expiresAt: string }> {
    const res = await this.get<{ success: boolean; challenge: string; expiresAt: string }>(
      '/rewards/v2/attest-seeker/challenge',
      { walletAddress },
    );
    return { challenge: res.challenge, expiresAt: res.expiresAt };
  }

  async attestSeeker(params: { walletAddress: string; challenge: string; signature: string }): Promise<void> {
    await this.post<{ success: boolean }>('/rewards/v2/attest-seeker', params);
  }

  async activateCashflowPassport(): Promise<{
    activationId: string;
    assetAddress: string;
    collectionAddress: string;
    innerInstructions: SerializedInstruction[];
    mintTransactionBase64: string;
    blockhash: string;
    mintFeeLamports: string;
  }> {
    const res = await this.signedPost<{
      success: boolean;
      data: {
        activationId: string;
        assetAddress: string;
        collectionAddress: string;
        innerInstructions: SerializedInstruction[];
        mintTransactionBase64: string;
        blockhash: string;
        mintFeeLamports: string;
      };
    }>('/rewards/v2/cashflow-passport/activate', {});
    return res.data;
  }

  async confirmCashflowPassportActivation(activationId: string, bundleSignatures: string[]): Promise<{ status: 'confirmed' | 'pending' | 'failed' }> {
    const res = await this.post<{ success: boolean; status: 'confirmed' | 'pending' | 'failed' }>(
      '/rewards/v2/cashflow-passport/activate/confirm',
      { activationId, bundleSignatures },
    );
    return { status: res.status };
  }

  async mintBadge(taskSlug: string): Promise<{
    badgeMintId: string;
    assetAddress: string;
    collectionAddress: string;
    updatePluginInstructions: SerializedInstruction[];
  }> {
    const res = await this.signedPost<{
      success: boolean;
      data: {
        badgeMintId: string;
        assetAddress: string;
        collectionAddress: string;
        updatePluginInstructions: SerializedInstruction[];
      };
    }>('/rewards/v2/badge/mint', { taskSlug });
    return res.data;
  }

  async confirmBadgeMint(badgeMintId: string, bundleSignatures: string[]): Promise<{ status: 'confirmed' | 'pending' | 'failed' }> {
    const res = await this.post<{ success: boolean; status: 'confirmed' | 'pending' | 'failed' }>(
      '/rewards/v2/badge/mint/confirm',
      { badgeMintId, bundleSignatures },
    );
    return { status: res.status };
  }

  async deposit(params: {
    type: string;
    mint: string;
    vaultAddress: string;
    amount: string;
    walletAddress: string;
  }): Promise<{ transactionId: string; transaction: string }> {
    const res = await this.signedPost<{
      success: boolean;
      transactionId: string;
      transaction: string;
    }>('/earn/v2/deposit', params);
    return { transactionId: res.transactionId, transaction: res.transaction };
  }

  async withdraw(params: {
    type: string;
    mint: string;
    vaultAddress: string;
    amount: string;
    walletAddress: string;
  }): Promise<{ transactionId: string; transaction: string }> {
    const res = await this.signedPost<{
      success: boolean;
      transactionId: string;
      transaction: string;
    }>('/earn/v2/withdraw', params);
    return { transactionId: res.transactionId, transaction: res.transaction };
  }
  async depositInstructions(params: {
    type: string;
    mint: string;
    vaultAddress: string;
    amount: string;
    walletAddress: string;
    ownerAddress: string;
  }): Promise<{ transactionId: string; instructions: SerializedInstruction[]; lookupTableAddress?: string; extraLookupTables?: string[] }> {
    const res = await this.signedPost<{
      success: boolean;
      transactionId: string;
      instructions: SerializedInstruction[];
      lookupTableAddress?: string;
      extraLookupTables?: string[];
    }>('/earn/v2/deposit', { ...params, returnInstructions: true });
    return { transactionId: res.transactionId, instructions: res.instructions, lookupTableAddress: res.lookupTableAddress, extraLookupTables: res.extraLookupTables };
  }

  async withdrawInstructions(params: {
    type: string;
    mint: string;
    vaultAddress: string;
    amount: string;
    walletAddress: string;
    ownerAddress: string;
  }): Promise<{ transactionId: string; instructions: SerializedInstruction[]; lookupTableAddress?: string; extraLookupTables?: string[] }> {
    const res = await this.signedPost<{
      success: boolean;
      transactionId: string;
      instructions: SerializedInstruction[];
      lookupTableAddress?: string;
      extraLookupTables?: string[];
    }>('/earn/v2/withdraw', { ...params, returnInstructions: true });
    return { transactionId: res.transactionId, instructions: res.instructions, lookupTableAddress: res.lookupTableAddress, extraLookupTables: res.extraLookupTables };
  }

  async transferInstructions(params: {
    mint: string;
    amount: string;
    ownerAddress: string;
    destinationAddress: string;
    walletAddress: string;
    decimals: number;
  }): Promise<{ transactionId: string; instructions: SerializedInstruction[] }> {
    const res = await this.signedPost<{
      success: boolean;
      transactionId: string;
      instructions: SerializedInstruction[];
    }>('/solana/v2/transfer', params);
    return { transactionId: res.transactionId, instructions: res.instructions };
  }

  async swapQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: string;
    slippageBps?: string;
  }): Promise<{
    outputAmount: string;
    outputUiAmount: number;
    priceImpactPct: number;
    minimumReceived: string;
    minimumReceivedUi: number;
  }> {
    const res = await this.get<{
      success: boolean;
      data: {
        outputAmount: string;
        outputUiAmount: number;
        priceImpactPct: number;
        minimumReceived: string;
        minimumReceivedUi: number;
      };
    }>('/solana/v2/swap-quote', params as Record<string, string>);
    return res.data;
  }

  async swapInstructions(params: {
    inputMint: string;
    outputMint: string;
    amount: string;
    walletAddress: string;
    ownerAddress: string;
    slippageBps?: number;
  }): Promise<{
    transactionId: string;
    instructions: SerializedInstruction[];
    extraLookupTables?: string[];
    quote: {
      outputAmount: string;
      outputUiAmount: number;
      priceImpactPct: number;
      minimumReceived: string;
      minimumReceivedUi: number;
    };
  }> {
    const res = await this.signedPost<{
      success: boolean;
      transactionId: string;
      instructions: SerializedInstruction[];
      extraLookupTables?: string[];
      quote: {
        outputAmount: string;
        outputUiAmount: number;
        priceImpactPct: number;
        minimumReceived: string;
        minimumReceivedUi: number;
      };
    }>('/solana/v2/swap', params);
    return {
      transactionId: res.transactionId,
      instructions: res.instructions,
      extraLookupTables: res.extraLookupTables,
      quote: res.quote,
    };
  }

  async getPopularTokens(): Promise<{
    mint: string;
    symbol: string;
    name: string;
    decimals: number;
    logoUrl: string;
  }[]> {
    const res = await this.get<{
      success: boolean;
      data: { mint: string; symbol: string; name: string; decimals: number; logoUrl: string }[];
    }>('/solana/v2/popular-tokens');
    return res.data;
  }

  async getSuggestions(params: {
    vaultAddress?: string;
    walletAddress?: string;
    threshold?: number;
    memberCount?: number;
    appVersion?: string;
    buildNumber?: string;
    osVersion?: string;
    device?: string;
    platform?: string;
  }): Promise<Suggestion[]> {
    const res = await this.signedPost<{ success: boolean; data: Suggestion[] }>('/suggestions/v2/', params);
    return res.data;
  }

  async buildTransfer(params: {
    fromAddress: string;
    toAddress: string;
    mint: string;
    amount: string;
    decimals: number;
  }): Promise<{ transaction: string }> {
    const res = await this.signedPost<{ success: boolean; transaction: string }>('/solana/v2/build-transfer', params);
    return { transaction: res.transaction };
  }

  async getSolPrice(): Promise<number> {
    const res = await this.get<{ success: boolean; data: { price: number } }>('/solana/v2/sol-price');
    return res.data.price;
  }

  async sendTransaction(transaction: string, transactionId: string): Promise<{ signature: string }> {
    const res = await this.signedPost<{
      success: boolean;
      signature: string;
    }>('/solana/v2/send', { transaction, transactionId });
    return { signature: res.signature };
  }

  async sendBundle(transactions: string[], transactionId?: string): Promise<{ bundleId: string; status: string; transactions: string[] }> {
    const res = await this.signedPost<{
      success: boolean;
      bundleId: string;
      status: string;
      transactions: string[];
    }>('/solana/v2/send-bundle', { transactions, transactionId });
    return { bundleId: res.bundleId, status: res.status, transactions: res.transactions ?? [] };
  }

  async submitBundleSignatures(transactionId: string, signatures: string[]): Promise<void> {
    await this.post('/solana/v2/submit-bundle-signatures', { transactionId, signatures });
  }
  async registerDeviceToken(fcmToken: string, deviceId: string): Promise<void> {
    await this.post('/notifications/v2/register-device', { fcmToken, deviceId });
  }

  async registerWaitlistDeviceToken(publicKey: string, fcmToken: string): Promise<void> {
    // Bypass auth — waitlist users don't have a vault yet, so auth/verify would fail
    const res = await fetch(`${this.baseUrl}/onboarding/v1/waitlist/register-device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey, fcmToken }),
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
  }

  async getNotificationHistory(params?: { limit?: number; before?: string }): Promise<{
    notifications: AppNotification[];
    hasMore: boolean;
  }> {
    const queryParams: Record<string, string> = {};
    if (params?.limit) queryParams.limit = String(params.limit);
    if (params?.before) queryParams.before = params.before;
    const res = await this.get<{ success: boolean; notifications: AppNotification[]; hasMore: boolean }>(
      '/notifications/v2/history',
      queryParams,
    );
    return { notifications: res.notifications, hasMore: res.hasMore };
  }

  async markNotificationsRead(notificationIds: string[]): Promise<void> {
    await this.post('/notifications/v2/mark-read', { notificationIds });
  }

  async getUnreadNotificationCount(): Promise<number> {
    const res = await this.get<{ success: boolean; count: number }>('/notifications/v2/unread-count');
    return res.count;
  }

  async getFirebaseToken(): Promise<{ firebaseToken: string; userId: string }> {
    const res = await this.post<{ success: boolean; firebaseToken: string; userId: string }>(
      '/notifications/v2/firebase-token',
      {},
    );
    return { firebaseToken: res.firebaseToken, userId: res.userId };
  }

  async resolveDomains(addresses: string[]): Promise<Record<string, string>> {
    const res = await this.post<{ success: boolean; data: Record<string, string> }>(
      '/solana/v2/resolve-domains',
      { addresses },
    );
    return res.data;
  }

  async resolveName(name: string): Promise<string | null> {
    try {
      const res = await this.post<{ success: boolean; data: { address: string } }>(
        '/solana/v2/resolve-name',
        { name },
      );
      return res.data?.address ?? null;
    } catch {
      return null;
    }
  }

  async findVaultsByMember(
    memberAddress: string,
    cloudKey?: string,
  ): Promise<{
    multisigs: Array<{
      multisigAddress: string;
      vaultAddress: string;
      threshold: number;
      memberCount: number;
      members: Array<{ address: string; permissions: { initiate: boolean; vote: boolean; execute: boolean } }>;
      matchesCloudKey?: boolean;
    }>;
  }> {
    // No auth — recovering users don't have a JWT yet
    const r = await fetch(`${this.baseUrl}/vault-recovery/v1/find-vaults`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberAddress, cloudKey: cloudKey || undefined }),
    });
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    const res = await r.json();
    return res.data;
  }

  async buildRecoveryProposalTx(params: {
    multisigAddress: string;
    walletAddress: string;
    members: Array<{ address: string; permissions: any }>;
    cloudKey?: string;
    addMemberActions: Array<{ memberAddress: string; permissions: string }>;
  }): Promise<{
    tx1Base64: string;
    tx2Base64: string;
    transactionIndex: number;
    blockhash: string;
    lastValidBlockHeight: number;
    threshold: number;
  }> {
    const r = await fetch(`${this.baseUrl}/vault-recovery/v1/build-proposal-tx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: 'Failed' }));
      throw new Error(err.error || `API error: ${r.status}`);
    }
    const res = await r.json();
    return res.data;
  }

  async sendSignedRecoveryTx(signedTransaction: string): Promise<{ signature: string }> {
    const r = await fetch(`${this.baseUrl}/solana/v1/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction: signedTransaction }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: 'Failed' }));
      throw new Error(err.error || `API error: ${r.status}`);
    }
    const res = await r.json();
    return res;
  }

  async findVaultByAddress(
    address: string,
  ): Promise<{
    multisigAddress: string;
    vaultAddress: string;
    threshold: number;
    memberCount: number;
    members: Array<{ address: string; permissions: { initiate: boolean; vote: boolean; execute: boolean } }>;
  } | null> {
    const r = await fetch(`${this.baseUrl}/vault-recovery/v1/find-vault-by-address`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    const res = await r.json();
    return res.data?.multisig || null;
  }

  async createRecoveryProposal(params: {
    multisigAddress: string;
    vaultAddress: string;
    transactionIndex: number;
    threshold: number;
    actions: Array<{ memberAddress: string; permissions: string }>;
    tx1MessageBase64: string;
    tx1Base64: string;
    tx2Base64: string;
    blockhash: string;
    requiredSigners: Array<{ address: string; type: string; label?: string; email?: string }>;
    collectedSignatures: Array<{ address: string; signature: string }>;
    createdByWallet: string;
    newCloudKey?: string;
  }): Promise<{ proposalId: string; status: string; signaturesCollected: number; signaturesRequired: number }> {
    const r = await fetch(`${this.baseUrl}/vault-recovery/v1/create-proposal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    const res = await r.json();
    return res.data;
  }

  async getRecoveryProposalStatus(proposalId: string): Promise<{
    proposalId: string;
    multisigAddress: string;
    vaultAddress: string;
    transactionIndex: number;
    threshold: number;
    status: string;
    signaturesCollected: number;
    requiredSigners: Array<{ address: string; type: string; label?: string; email?: string; signed: boolean }>;
  }> {
    const r = await fetch(`${this.baseUrl}/vault-recovery/v1/proposal/${proposalId}`);
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    const res = await r.json();
    return res.data;
  }

  async buildApproveTx(memberAddress: string, multisigAddress: string, transactionIndex: number, feePayerAddress?: string): Promise<{
    transaction: string;
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    const r = await fetch(`${this.baseUrl}/vault-recovery/v1/build-approve-tx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberAddress, multisigAddress, transactionIndex, feePayerAddress }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: 'Failed' }));
      throw new Error(err.error || `API error: ${r.status}`);
    }
    const res = await r.json();
    return res.data;
  }

  async sendApproveTx(proposalId: string, signedTransaction: string): Promise<{ signature: string }> {
    const r = await fetch(`${this.baseUrl}/vault-recovery/v1/proposal/${proposalId}/send-approve-tx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedTransaction }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: 'Failed' }));
      throw new Error(err.error || `API error: ${r.status}`);
    }
    const res = await r.json();
    return res.data;
  }

  async requestPrivySign(proposalId: string, walletAddress: string): Promise<{
    signaturesCollected: number;
    status: string;
    signerAddress: string;
  }> {
    const r = await fetch(`${this.baseUrl}/vault-recovery/v1/proposal/${proposalId}/sign-privy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ error: 'Failed' }));
      throw new Error(err.error || `API error: ${r.status}`);
    }
    const res = await r.json();
    return res.data;
  }

  async getAssembledRecoveryTx(proposalId: string): Promise<{
    tx1Base64: string;
    tx2Base64: string;
    signatures: Array<{ address: string; signature: string }>;
  }> {
    const r = await fetch(`${this.baseUrl}/vault-recovery/v1/proposal/${proposalId}/assembled-tx`);
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    const res = await r.json();
    return res.data;
  }


}

export default new ApiService();
