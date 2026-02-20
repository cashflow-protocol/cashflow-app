import axios, { AxiosInstance } from 'axios';
import {
  address,
  pipe,
  createSolanaRpc,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  compileTransaction,
  getBase64EncodedWireTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  AccountRole,
} from '@solana/kit';
import type { Rpc, SolanaRpcApi, Address } from '@solana/kit';
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
  apy: string;
  apy7d: string;
  apy24h: string;
  apy30d: string;
  apy90d: string;
  apy180d: string;
  apy365d: string;
  apyTheoretical: string;
  apyActual: string;
  apyFarmRewards: string;
  apyIncentives: string;
  apyReservesIncentives: string;
  tokenPrice: string;
  solPrice: string;
  tokensAvailable: string;
  tokensAvailableUsd: string;
  tokensInvested: string;
  tokensInvestedUsd: string;
  sharePrice: string;
  tokensPerShare: string;
  numberOfHolders: number;
  sharesIssued: string;
  cumulativeInterestEarned: string;
  cumulativeInterestEarnedUsd: string;
  cumulativeInterestEarnedSol: string;
  interestEarnedPerSecond: string;
  interestEarnedPerSecondUsd: string;
  interestEarnedPerSecondSol: string;
  cumulativePerformanceFees: string;
  cumulativePerformanceFeesUsd: string;
  cumulativePerformanceFeesSol: string;
  cumulativeManagementFees: string;
  cumulativeManagementFeesUsd: string;
  cumulativeManagementFeesSol: string;
}

interface KaminoAccountMeta {
  address: string;
  role: 'WRITABLE_SIGNER' | 'WRITABLE' | 'READONLY_SIGNER' | 'READONLY';
}

interface KaminoInstruction {
  programAddress: string;
  accounts: KaminoAccountMeta[];
  data: string | null;
}

interface KaminoInstructionsResponse {
  instructions: KaminoInstruction[];
  lutsByAddress: Record<string, string[]>;
}

const ROLE_MAP: Record<string, AccountRole> = {
  WRITABLE_SIGNER: AccountRole.WRITABLE_SIGNER,
  READONLY_SIGNER: AccountRole.READONLY_SIGNER,
  WRITABLE: AccountRole.WRITABLE,
  READONLY: AccountRole.READONLY,
};

const METRICS_DELAY_MS = 500;

export class KaminoManager {
  private api: AxiosInstance;
  private rpc: Rpc<SolanaRpcApi>;
  private readonly baseURL = 'https://api.kamino.finance';

  constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.rpc = createSolanaRpc(rpcUrl);
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
                  rewardsRate: (parseFloat(metrics!.apy) + parseFloat(metrics!.apyIncentives) + parseFloat(metrics!.apyReservesIncentives) + parseFloat(metrics!.apyFarmRewards)) * 10000,
                  kaminoToken: { ...vault, metrics },
                },
                $setOnInsert: {
                  status: 'inactive' as const,
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

  /**
   * Get wallet positions across all active Kamino vaults
   * Fetches per-vault position and converts shares to underlying token amounts
   */
  async getWalletPositions(walletAddress: string): Promise<{ vaultAddress: string; mint: string; amount: string }[]> {
    try {
      const vaults = await EarnTokenModel.find({ type: 'kamino', status: 'active' }).lean();
      if (vaults.length === 0) return [];

      const positions = await Promise.all(
        vaults.map(async (vault) => {
          try {
            const response = await this.api.get<{ vaultAddress: string; stakedShares: string; unstakedShares: string; totalShares: string }>(
              `/kvaults/users/${walletAddress}/positions/${vault.vaultAddress}`,
            );

            const totalShares = parseFloat(response.data.totalShares);
            if (totalShares <= 0) return null;

            const tokensPerShare = parseFloat(vault.kaminoToken?.metrics?.tokensPerShare ?? '1');
            const tokenDecimals = vault.kaminoToken?.state?.tokenMintDecimals ?? 6;
            const underlyingAmount = Math.floor(totalShares * tokensPerShare * 10 ** tokenDecimals);

            return {
              vaultAddress: vault.vaultAddress!,
              mint: vault.mint,
              amount: underlyingAmount.toString(),
            };
          } catch {
            return null;
          }
        }),
      );

      return positions.filter((p): p is NonNullable<typeof p> => p !== null);
    } catch (error) {
      console.error('Error fetching Kamino wallet positions:', error);
      return [];
    }
  }

  /**
   * Get an unsigned deposit transaction from Kamino
   * @param vaultAddress Kamino vault address (kvault)
   * @param amount Amount in decimal format (e.g. "0.1")
   * @param walletAddress Wallet address
   */
  async deposit(vaultAddress: string, amount: string, walletAddress: string): Promise<string> {
    try {
      const response = await this.api.post<KaminoInstructionsResponse>(
        '/ktx/kvault/deposit-instructions',
        { wallet: walletAddress, kvault: vaultAddress, amount },
      );
      return await this.buildTransaction(response.data, walletAddress);
    } catch (error) {
      console.error('Error creating Kamino deposit transaction:', error);
      throw error;
    }
  }

  /**
   * Get an unsigned withdraw transaction from Kamino
   * @param vaultAddress Kamino vault address (kvault)
   * @param amount Amount in decimal format (e.g. "0.1"), use U64 max to withdraw all
   * @param walletAddress Wallet address
   */
  async withdraw(vaultAddress: string, amount: string, walletAddress: string): Promise<string> {
    try {
      const response = await this.api.post<KaminoInstructionsResponse>(
        '/ktx/kvault/withdraw-instructions',
        { wallet: walletAddress, kvault: vaultAddress, amount },
      );
      return await this.buildTransaction(response.data, walletAddress);
    } catch (error) {
      console.error('Error creating Kamino withdraw transaction:', error);
      throw error;
    }
  }

  /**
   * Convert Kamino instructions response into a base64-encoded unsigned versioned transaction
   */
  private async buildTransaction(data: KaminoInstructionsResponse, feePayer: string): Promise<string> {
    const instructions = data.instructions.map((ix) => ({
      programAddress: address(ix.programAddress),
      accounts: ix.accounts.map((acc) => ({
        address: address(acc.address),
        role: ROLE_MAP[acc.role] ?? AccountRole.READONLY,
      })),
      data: ix.data ? new Uint8Array(Buffer.from(ix.data, 'base64')) : new Uint8Array(0),
    }));

    const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();

    const baseMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayer(address(feePayer), tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (tx) => instructions.reduce((msg: any, ix) => appendTransactionMessageInstruction(ix, msg), tx),
    );

    // Compress using address lookup tables if provided
    const lutEntries = Object.entries(data.lutsByAddress);
    let transactionMessage = baseMessage;
    if (lutEntries.length > 0) {
      const addressesByLookupTableAddress: { [key: Address]: Address[] } = {};
      for (const [lutAddress, addresses] of lutEntries) {
        addressesByLookupTableAddress[address(lutAddress)] = addresses.map((a) => address(a));
      }
      transactionMessage = compressTransactionMessageUsingAddressLookupTables(
        baseMessage,
        addressesByLookupTableAddress,
      ) as typeof baseMessage;
    }

    const compiled = compileTransaction(transactionMessage);
    return getBase64EncodedWireTransaction(compiled);
  }
}

export default KaminoManager;
