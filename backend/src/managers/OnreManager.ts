import axios, { AxiosInstance } from 'axios';
import { EarnTokenType } from '../types';
import { DBManager, EarnTokenUpsert } from './DBManager';

const ONRE_ICON_URL = 'https://cashflowfi.ams3.cdn.digitaloceanspaces.com/logos/onre.jpg';
const ONYC_MINT = '5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5';

export class OnreManager {
  private api: AxiosInstance;
  private db: DBManager;

  constructor() {
    this.db = new DBManager();
    this.api = axios.create({
      baseURL: 'https://core.api.onre.finance',
      timeout: 30_000,
    });
  }

  /**
   * Fetch current APY from Onre, then upsert into the database.
   */
  async getEarnTokens(): Promise<void> {
    const { data: apyRaw } = await this.api.get<string>('/data/live-apy');

    const apy = parseFloat(apyRaw);

    // rewardsRate convention: mobile displays (rewardsRate / 100).toFixed(2) + '%'
    // Onre returns apy as a decimal (e.g. 0.1017 for 10.17%), so rewardsRate = apy * 10000
    const rewardsRate = Math.round(apy * 10000);

    const token: EarnTokenUpsert = {
      type: EarnTokenType.ONRE,
      mint: ONYC_MINT,
      vaultAddress: ONYC_MINT,
      vaultTitle: 'Onre - ONyc',
      symbol: 'ONyc',
      rewardsRate,
      minAppBuild: 20,
      protocolName: 'Onre',
      protocolIconUrl: ONRE_ICON_URL,
      protocolData: { apy: apyRaw },
    };

    await this.db.upsertEarnTokens([token]);
  }
}
