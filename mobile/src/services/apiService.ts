import { API_CONFIG } from '../config/api';
import type { EarnToken, EarnPosition, WalletAsset, Suggestion } from '../types/earn';

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
    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`API error: ${res.status}`);
    }
    return res.json();
  }

  async getConfig(): Promise<{ lookupTableAddress: string | null }> {
    const res = await this.get<{ success: boolean; data: { lookupTableAddress: string | null } }>('/config/v1');
    return res.data;
  }

  async getEarnTokens(): Promise<EarnToken[]> {
    const res = await this.get<{ success: boolean; data: EarnToken[] }>('/earn/v1/tokens');
    return res.data;
  }

  async getWalletBalance(walletAddress: string, mint: string): Promise<{ amount: string; uiAmount: number }> {
    const res = await this.get<{ success: boolean; data: { mint: string; amount: string; uiAmount: number } }>(
      '/solana/v1/wallet-balance',
      { walletAddress, mint },
    );
    return { amount: res.data.amount, uiAmount: res.data.uiAmount };
  }

  async getEmptyTokenAccounts(walletAddress: string): Promise<{ total: number; empty: number }> {
    const res = await this.get<{ success: boolean; data: { total: number; empty: number } }>(
      '/solana/v1/empty-token-accounts',
      { walletAddress },
    );
    return res.data;
  }

  async getAssets(walletAddress: string): Promise<{ totalUsdValue: number; assets: WalletAsset[] }> {
    const res = await this.get<{
      success: boolean;
      data: { totalUsdValue: number; assets: WalletAsset[] };
    }>('/solana/v1/assets', { walletAddress });
    return res.data;
  }

  async getPositions(walletAddress: string): Promise<EarnPosition[]> {
    const res = await this.get<{ success: boolean; data: EarnPosition[] }>('/earn/v1/positions', {
      walletAddress,
    });
    return res.data;
  }

  private async post<T>(path: string, body: Record<string, any>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      throw new Error(errorBody.error || `API error: ${res.status}`);
    }
    return res.json();
  }

  async debugLog(tag: string, lines: string[]): Promise<void> {
    await this.post('/debug/log', { tag, lines });
  }

  async deposit(params: {
    type: string;
    mint: string;
    vaultAddress: string;
    amount: string;
    walletAddress: string;
  }): Promise<{ transactionId: string; transaction: string }> {
    const res = await this.post<{
      success: boolean;
      transactionId: string;
      transaction: string;
    }>('/earn/v1/deposit', params);
    return { transactionId: res.transactionId, transaction: res.transaction };
  }

  async withdraw(params: {
    type: string;
    mint: string;
    vaultAddress: string;
    amount: string;
    walletAddress: string;
  }): Promise<{ transactionId: string; transaction: string }> {
    const res = await this.post<{
      success: boolean;
      transactionId: string;
      transaction: string;
    }>('/earn/v1/withdraw', params);
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
    const res = await this.post<{
      success: boolean;
      transactionId: string;
      instructions: SerializedInstruction[];
      lookupTableAddress?: string;
      extraLookupTables?: string[];
    }>('/earn/v1/deposit', { ...params, returnInstructions: true });
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
    const res = await this.post<{
      success: boolean;
      transactionId: string;
      instructions: SerializedInstruction[];
      lookupTableAddress?: string;
      extraLookupTables?: string[];
    }>('/earn/v1/withdraw', { ...params, returnInstructions: true });
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
    const res = await this.post<{
      success: boolean;
      transactionId: string;
      instructions: SerializedInstruction[];
    }>('/solana/v1/transfer', params);
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
    const res = await this.post<{ success: boolean; data: Suggestion[] }>('/suggestions/v1/', params);
    return res.data;
  }

  async buildTransfer(params: {
    fromAddress: string;
    toAddress: string;
    mint: string;
    amount: string;
    decimals: number;
  }): Promise<{ transaction: string }> {
    const res = await this.post<{ success: boolean; transaction: string }>('/solana/v1/build-transfer', params);
    return { transaction: res.transaction };
  }

  async getSolPrice(): Promise<number> {
    const res = await this.get<{ success: boolean; data: { price: number } }>('/solana/v1/sol-price');
    return res.data.price;
  }

  async sendTransaction(transaction: string, transactionId: string): Promise<{ signature: string }> {
    const res = await this.post<{
      success: boolean;
      signature: string;
    }>('/solana/v1/send', { transaction, transactionId });
    return { signature: res.signature };
  }

  async sendBundle(transactions: string[]): Promise<{ bundleId: string; status: string }> {
    const res = await this.post<{
      success: boolean;
      bundleId: string;
      status: string;
    }>('/solana/v1/send-bundle', { transactions });
    return { bundleId: res.bundleId, status: res.status };
  }
}

export default new ApiService();
