import axios, { AxiosInstance } from 'axios';
import { EarnTokenType } from '../types';
import { DBManager, EarnTokenUpsert } from './DBManager';

const PERENA_ICON_URL = 'https://app.perena.org/perena-logo.svg';
const USD_STAR_MINT = 'star9agSpjiFe3M49B3RniVU4CMBBEK3Qnaqn3RGiFM';

interface PerenaApyResponse {
  period: string;
  apy: number;
  timestamp: string;
}

interface PerenaMintInfoResponse {
  mint: string;
  decimals: number;
  price: number;
  supply: number;
  tvl: number;
  timestamp: string;
}

export class PerenaManager {
  private api: AxiosInstance;
  private db: DBManager;

  constructor() {
    this.db = new DBManager();
    this.api = axios.create({
      baseURL: 'https://api.perena.org',
      timeout: 30_000,
    });
  }

  /**
   * Fetch current APY and mint info from Perena, then upsert into the database.
   */
  async getEarnTokens(): Promise<void> {
    const [apyRes, mintInfoRes] = await Promise.all([
      this.api.get<PerenaApyResponse>('/api/usdstar/apy', { params: { period: '7d' } }),
      this.api.get<PerenaMintInfoResponse>('/api/usdstar/mint-info'),
    ]);

    const { apy } = apyRes.data;
    const mintInfo = mintInfoRes.data;

    // rewardsRate convention: mobile displays (rewardsRate / 100).toFixed(2) + '%'
    // Perena returns apy as a percentage (e.g. 5.0 for 5%), so rewardsRate = apy * 100
    const rewardsRate = Math.round(apy * 100);

    const token: EarnTokenUpsert = {
      type: EarnTokenType.PERENA,
      mint: USD_STAR_MINT,
      vaultAddress: USD_STAR_MINT, // Perena has a single yield token, not separate vaults
      vaultTitle: 'Perena - USD*',
      symbol: 'USD*',
      rewardsRate,
      protocolName: 'Perena',
      protocolIconUrl: PERENA_ICON_URL,
      protocolData: {
        apy: apyRes.data,
        mintInfo,
      },
    };

    await this.db.upsertEarnTokens([token]);
  }
}
