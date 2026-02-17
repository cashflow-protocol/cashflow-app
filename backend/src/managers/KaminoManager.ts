import axios, { AxiosInstance } from 'axios';
import { EarnTokenModel } from '../models';
import { SUPPORTED_TOKEN_MINTS, SUPPORTED_TOKENS_BY_MINT } from '../constants';

interface KaminoAllocationStrategy {
  reserve: string;
  ctokenVault: string;
  targetAllocationWeight: number;
  tokenAllocationCap: string;
  ctokenVaultBump: number;
  ctokenAllocation: string;
  lastInvestSlot: string;
  tokenTargetAllocation: string;
}

interface KaminoVaultState {
  vaultAdminAuthority: string;
  baseVaultAuthority: string;
  baseVaultAuthorityBump: number;
  tokenMint: string;
  tokenMintDecimals: number;
  tokenVault: string;
  tokenProgram: string;
  sharesMint: string;
  sharesMintDecimals: number;
  tokenAvailable: string;
  sharesIssued: string;
  availableCrankFunds: string;
  performanceFeeBps: number;
  managementFeeBps: number;
  lastFeeChargeTimestamp: number;
  prevAum: string;
  pendingFees: string;
  vaultAllocationStrategy: KaminoAllocationStrategy[];
  minDepositAmount: string;
  minWithdrawAmount: string;
  minInvestAmount: string;
  minInvestDelaySlots: number;
  crankFundFeePerReserve: string;
  pendingAdmin: string;
  cumulativeEarnedInterest: string;
  cumulativeMgmtFees: string;
  cumulativePerfFees: string;
  name: string;
  vaultLookupTable: string;
  vaultFarm: string;
  creationTimestamp: number;
  allocationAdmin: string;
}

interface KaminoVault {
  address: string;
  state: KaminoVaultState;
  programId: string;
}

interface KaminoMetrics {
  apy: number;
  [key: string]: any;
}

const METRICS_DELAY_MS = 200;

export class KaminoManager {
  private api: AxiosInstance;
  private readonly baseURL = 'https://api.kamino.finance';

  constructor() {
    this.api = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Fetch earn tokens from Kamino API and save to MongoDB
   * @returns List of all Kamino vaults
   */
  async getEarnTokens(): Promise<KaminoVault[]> {
    try {
      const response = await this.api.get<KaminoVault[]>('/kvaults/vaults');

      const supportedVaults = response.data.filter((vault) =>
        SUPPORTED_TOKEN_MINTS.includes(vault.state.tokenMint)
      );

      console.log(
        `Kamino: found ${supportedVaults.length} supported vaults out of ${response.data.length} total`
      );

      await this.saveTokensToDatabase(supportedVaults);

      return response.data;
    } catch (error) {
      console.error('Error fetching Kamino earn tokens:', error);
      throw error;
    }
  }

  /**
   * Fetch metrics for a specific vault
   */
  private async fetchMetrics(vaultAddress: string): Promise<KaminoMetrics | null> {
    try {
      const response = await this.api.get<KaminoMetrics>(
        `/kvaults/vaults/${vaultAddress}/metrics`
      );
      return response.data;
    } catch (error) {
      console.error(`Error fetching Kamino metrics for vault ${vaultAddress}:`, error);
      return null;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Save or update Kamino earn tokens in MongoDB
   */
  private async saveTokensToDatabase(vaults: KaminoVault[]): Promise<void> {
    try {
      // Fetch metrics for each vault with delays to respect rate limits
      const vaultsWithMetrics: { vault: KaminoVault; metrics: KaminoMetrics | null }[] = [];

      for (const vault of vaults) {
        const metrics = await this.fetchMetrics(vault.address);
        vaultsWithMetrics.push({ vault, metrics });
        await this.delay(METRICS_DELAY_MS);
      }

      const bulkOps = vaultsWithMetrics
        .filter(({ metrics }) => metrics !== null)
        .map(({ vault, metrics }) => {
          const symbol = SUPPORTED_TOKENS_BY_MINT[vault.state.tokenMint]?.symbol ?? '';

          return {
            updateOne: {
              filter: {
                type: 'kamino' as const,
                mint: vault.state.tokenMint,
                vaultAddress: vault.address,
              },
              update: {
                $set: {
                  type: 'kamino' as const,
                  mint: vault.state.tokenMint,
                  vaultAddress: vault.address,
                  vaultTitle: vault.state.name,
                  symbol,
                  rewardsRate: metrics!.apy * 100,
                  kaminoToken: { ...vault, metrics }, // Full vault data + metrics
                },
              },
              upsert: true,
            },
          };
        });

      if (bulkOps.length === 0) {
        console.log('⚠️ [Kamino] No tokens with valid metrics to save');
        return;
      }

      const result = await EarnTokenModel.bulkWrite(bulkOps as any);

      console.log(
        `✅ [Kamino] Saved ${result.upsertedCount} new tokens, updated ${result.modifiedCount} existing tokens`
      );
    } catch (error) {
      console.error('Error saving Kamino tokens to database:', error);
      throw error;
    }
  }
}

export default KaminoManager;
