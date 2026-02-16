import axios, { AxiosInstance } from 'axios';
import { EarnTokenModel } from '../models';

interface JupiterAsset {
  address: string;
  chainId: string;
  name: string;
  symbol: string;
  uiSymbol: string;
  decimals: number;
  logoUrl: string;
  price: string;
  coingeckoId: string;
  updatedAt: string;
}

interface LiquiditySupplyData {
  modeWithInterest: boolean;
  supply: string;
  withdrawalLimit: string;
  lastUpdateTimestamp: string;
  expandPercent: number;
  expandDuration: string;
  baseWithdrawalLimit: string;
  withdrawableUntilLimit: string;
  withdrawable: string;
}

interface JupiterEarnTokenResponse {
  id: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  assetAddress: string;
  asset: JupiterAsset;
  totalAssets: string;
  totalSupply: string;
  convertToShares: string;
  convertToAssets: string;
  rewardsRate: string;
  supplyRate: string;
  totalRate: string;
  rebalanceDifference: string;
  liquiditySupplyData: LiquiditySupplyData;
  rewards: any[];
}

export class JupiterManager {
  private api: AxiosInstance;
  private readonly baseURL = 'https://api.jup.ag';

  constructor() {
    const apiKey = process.env.JUPITER_API_KEY;

    if (!apiKey) {
      console.warn('Warning: JUPITER_API_KEY not set in environment variables');
    }

    this.api = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { 'x-api-key': apiKey }),
      },
    });
  }

  /**
   * Get earn tokens from Jupiter Lend API and save to MongoDB
   * @returns List of tokens with lending/earn opportunities
   */
  async getEarnTokens(): Promise<JupiterEarnTokenResponse[]> {
    try {
      const response = await this.api.get<JupiterEarnTokenResponse[]>('/lend/v1/earn/tokens');
      console.log('Jupiter Lend Earn Tokens:', JSON.stringify(response.data, null, 2));

      // Save tokens to MongoDB
      await this.saveTokensToDatabase(response.data);

      return response.data;
    } catch (error) {
      console.error('Error fetching Jupiter earn tokens:', error);
      throw error;
    }
  }

  /**
   * Save or update earn tokens in MongoDB
   * @param tokens Array of Jupiter earn tokens
   */
  private async saveTokensToDatabase(tokens: JupiterEarnTokenResponse[]): Promise<void> {
    try {
      const bulkOps = tokens.map((token) => ({
        updateOne: {
          filter: {
            type: 'jupiter' as const,
            mint: token.asset.address,
          },
          update: {
            $set: {
              type: 'jupiter' as const,
              mint: token.asset.address,
              decimals: token.asset.decimals,
              symbol: token.asset.symbol,
              name: token.asset.name,
              rewardsRate: parseFloat(token.totalRate),
              logoUrl: token.asset.logoUrl,
              jupiterToken: token, // Save the whole token data
            },
          },
          upsert: true, // Create if doesn't exist, update if exists
        },
      }));

      const result = await EarnTokenModel.bulkWrite(bulkOps as any);

      console.log(`✅ Saved ${result.upsertedCount} new tokens, updated ${result.modifiedCount} existing tokens`);
    } catch (error) {
      console.error('Error saving tokens to database:', error);
      throw error;
    }
  }
}

export default JupiterManager;
