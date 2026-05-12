import axios, { AxiosInstance } from 'axios';
import { EarnTokenType } from '../types';
import { DBManager, EarnTokenUpsert } from './DBManager';

const SOLOMON_ICON_URL = 'https://cashflowfi.ams3.cdn.digitaloceanspaces.com/logos/solomon.png';
const SUSDV_MINT = 'pTA4St7D5WshfLUPBXoaxn5m8e3k2ort2DVt3gUTa17';

interface VestingInfo {
  id: number;
  vestingAmount: string;
  vestingStartTimestamp: number;
  vestingEndTimestamp: number;
  dailyApy: string;
  sevenDayApy: string;
  thirtyDayApy: string;
  monthToDateApy: string;
  yearToDateApy: string;
  allTimeApy: string;
}

interface SolomonStatsResponse {
  sharePrice: string;
  totalStaked: string;
  totalUnstaking: string;
  totalShares: string;
  stakersCount: number;
  unstakersCount: number;
  previousVestingInfo: VestingInfo;
  currentVestingInfo: VestingInfo;
}

export class SolomonManager {
  private api: AxiosInstance;
  private db: DBManager;

  constructor() {
    this.db = new DBManager();
    this.api = axios.create({
      baseURL: 'https://data.solomonlabs.io',
      timeout: 30_000,
    });
  }

  /**
   * Fetch current staking stats from Solomon, then upsert into the database.
   */
  async getEarnTokens(): Promise<void> {
    const { data } = await this.api.get<SolomonStatsResponse>(
      '/api/solomon-protocol/staking/stats',
    );

    const apy = parseFloat(data.previousVestingInfo.monthToDateApy);

    // rewardsRate convention: mobile displays (rewardsRate / 100).toFixed(2) + '%'
    // Solomon returns apy as a decimal (e.g. 0.0914 for 9.14%), so rewardsRate = apy * 10000
    const rewardsRate = Math.round(apy * 10000);

    const token: EarnTokenUpsert = {
      type: EarnTokenType.SOLOMON,
      mint: SUSDV_MINT,
      vaultAddress: SUSDV_MINT,
      vaultTitle: 'Solomon - sUSDv',
      symbol: 'sUSDv',
      rewardsRate,
      minAppBuild: 20,
      protocolName: 'Solomon',
      protocolIconUrl: SOLOMON_ICON_URL,
      protocolData: data,
    };

    await this.db.upsertEarnTokens([token]);
  }
}
