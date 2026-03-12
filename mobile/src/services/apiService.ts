import { API_CONFIG } from '../config/api';
import type { EarnToken, EarnPosition, WalletAsset, Suggestion } from '../types/earn';
import authService from './authService';
import { verifyResponseSignature } from './responseVerifier';

export interface SerializedInstruction {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string; // base64-encoded
}

class ApiService {
  private baseUrl = API_CONFIG.baseUrl;

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

  async getConfig(): Promise<{ lookupTableAddress: string | null; solanaRpcUrl: string | null }> {
    // Config is needed during vault creation (before auth is available) — bypass auth
    const r = await fetch(`${this.baseUrl}/config/v1`);
    if (!r.ok) throw new Error(`API error: ${r.status}`);
    const res: { success: boolean; data: { lookupTableAddress: string | null; solanaRpcUrl: string | null } } = await r.json();
    return res.data;
  }

  async getEarnTokens(): Promise<EarnToken[]> {
    const res = await this.get<{ success: boolean; data: EarnToken[] }>('/earn/v2/tokens');
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
    const res = await this.post<T & { responseSignature?: string }>(path, body);
    const valid = await verifyResponseSignature(res as Record<string, any>);
    if (!valid) {
      throw new Error('Response integrity check failed');
    }
    const { responseSignature: _, ...data } = res as any;
    return data as T;
  }

  async debugLog(tag: string, lines: string[]): Promise<void> {
    // Debug log is an unauthenticated inline route — bypass auth
    await fetch(`${this.baseUrl}/debug/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag, lines }),
    });
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

  async getSuggestions(params: {
    vaultAddress?: string;
    walletAddress?: string;
    appVersion?: string;
    buildNumber?: string;
    osVersion?: string;
    device?: string;
    platform?: string;
  }): Promise<Suggestion[]> {
    const res = await this.post<{ success: boolean; data: Suggestion[] }>('/suggestions/v2/', params);
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

  async sendBundle(transactions: string[]): Promise<{ bundleId: string; status: string }> {
    const res = await this.signedPost<{
      success: boolean;
      bundleId: string;
      status: string;
    }>('/solana/v2/send-bundle', { transactions });
    return { bundleId: res.bundleId, status: res.status };
  }
}

export default new ApiService();
