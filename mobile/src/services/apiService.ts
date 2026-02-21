import { API_CONFIG } from '../config/api';
import type { EarnToken, EarnPosition } from '../types/earn';

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

  async getEarnTokens(): Promise<EarnToken[]> {
    const res = await this.get<{ success: boolean; data: EarnToken[] }>('/earn/v1/tokens');
    return res.data;
  }

  async getPositions(walletAddress: string): Promise<EarnPosition[]> {
    const res = await this.get<{ success: boolean; data: EarnPosition[] }>('/earn/v1/positions', {
      walletAddress,
    });
    return res.data;
  }
}

export default new ApiService();
