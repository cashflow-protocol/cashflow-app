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
  fetchAddressesForLookupTables,
} from '@solana/kit';
import type { Rpc, SolanaRpcApi, Instruction, TransactionSigner } from '@solana/kit';
import { AccountRole } from '@solana/kit';
import { KaminoVault } from '@kamino-finance/klend-sdk';
import {
  createSolanaRpc as createKaminoRpc,
  address as kaminoAddress,
} from '@kamino-finance/klend-sdk/node_modules/@solana/kit';
import Decimal from 'decimal.js';
import { SUPPORTED_TOKEN_MINTS, SUPPORTED_TOKENS_BY_MINT } from '../constants';
import { EarnTokenType } from '../types';
import type { SerializedInstruction } from '../types';
import { DBManager, EarnTokenUpsert } from './DBManager';

// --- REST API types (used by getEarnTokens cron job) ---

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

interface KaminoVaultResponse {
  address: string;
  state: {
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
  };
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

const METRICS_DELAY_MS = 500;

/**
 * Create a noop TransactionSigner for building unsigned transactions.
 * The signer has the correct address for PDA derivation and account setup,
 * but does not actually sign — the mobile client signs after receiving the tx.
 */
function createNoopSigner(walletAddr: string): TransactionSigner {
  return {
    address: address(walletAddr),
    signTransactions: async (txs: any[]) => txs.map(() => ({})),
  } as TransactionSigner;
}

/**
 * Create a noop signer compatible with klend-sdk's bundled @solana/kit@2.x.
 * The klend-sdk ships its own @solana/kit@2.3, which is incompatible at runtime
 * with our top-level @solana/kit@6.x. Using the SDK's own address() avoids
 * cross-version type mismatches that cause "Network request failed" errors.
 */
function createKaminoNoopSigner(walletAddr: string): any {
  return {
    address: kaminoAddress(walletAddr),
    signTransactions: async (txs: any[]) => txs.map(() => ({})),
  };
}

export class KaminoManager {
  private api: AxiosInstance;
  private rpc: Rpc<SolanaRpcApi>;
  private kaminoRpc: any; // klend-sdk's own @solana/kit@2.x RPC
  private db: DBManager;
  private readonly baseURL = 'https://api.kamino.finance';

  constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.rpc = createSolanaRpc(rpcUrl);
    this.kaminoRpc = createKaminoRpc(rpcUrl);
    this.db = new DBManager();
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
   */
  async getEarnTokens(): Promise<KaminoVaultResponse[]> {
    try {
      const response = await this.api.get<KaminoVaultResponse[]>('/kvaults/vaults');

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

  private async fetchMetrics(vaultAddress: string): Promise<KaminoMetrics | null> {
    try {
      const response = await this.api.get<KaminoMetrics>(
        `/kvaults/vaults/${vaultAddress}/metrics`
      );
      return response.data;
    } catch (error) {
      console.error(`Error fetching Kamino metrics for vault ${vaultAddress}`);
      return null;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async saveTokensToDatabase(vaults: KaminoVaultResponse[]): Promise<void> {
    const vaultsWithMetrics: { vault: KaminoVaultResponse; metrics: KaminoMetrics | null }[] = [];

    for (const vault of vaults) {
      const metrics = await this.fetchMetrics(vault.address);
      vaultsWithMetrics.push({ vault, metrics });
      await this.delay(METRICS_DELAY_MS);
    }

    const upserts: EarnTokenUpsert[] = vaultsWithMetrics
      .filter(({ metrics }) => metrics !== null)
      .map(({ vault, metrics }) => ({
        type: EarnTokenType.KAMINO,
        mint: vault.state.tokenMint,
        vaultAddress: vault.address,
        vaultTitle: vault.state.name,
        symbol: SUPPORTED_TOKENS_BY_MINT[vault.state.tokenMint]?.symbol ?? '',
        rewardsRate: ((parseFloat(metrics!.apy) || 0) + (parseFloat(metrics!.apyIncentives) || 0) + (parseFloat(metrics!.apyReservesIncentives) || 0) + (parseFloat(metrics!.apyFarmRewards) || 0)) * 10000,
        minDepositAmount: vault.state.minDepositAmount ?? '0',
        minWithdrawAmount: vault.state.minWithdrawAmount ?? '0',
        protocolData: { ...vault, metrics },
      }));

    await this.db.upsertEarnTokens(upserts);
  }

  /**
   * Get raw deposit instructions for Kamino (used by Squads vault flow)
   */
  async getDepositInstructions(vaultAddress: string, amount: string, ownerAddress: string): Promise<SerializedInstruction[]> {
    const vault = new KaminoVault(this.kaminoRpc, kaminoAddress(vaultAddress));
    const signer = createKaminoNoopSigner(ownerAddress);

    const depositResult = await vault.depositIxs(signer, new Decimal(amount));

    const allIxs = [
      ...depositResult.depositIxs,
      ...depositResult.stakeInFarmIfNeededIxs,
    ];

    return allIxs.map((ix: any) => this.kitIxToSerialized(ix)).map(ix => this.makeAtaIdempotent(ix));
  }

  /**
   * Get raw withdraw instructions for Kamino (used by Squads vault flow)
   */
  async getWithdrawInstructions(vaultAddress: string, amount: string, ownerAddress: string): Promise<SerializedInstruction[]> {
    const vault = new KaminoVault(this.kaminoRpc, kaminoAddress(vaultAddress));
    const signer = createKaminoNoopSigner(ownerAddress);

    const exchangeRate = await vault.getExchangeRate();
    const shareAmount = new Decimal(amount).div(exchangeRate);

    const withdrawResult = await vault.withdrawIxs(signer, shareAmount);

    const allIxs = [
      ...withdrawResult.unstakeFromFarmIfNeededIxs,
      ...withdrawResult.withdrawIxs,
      ...withdrawResult.postWithdrawIxs,
    ];

    return allIxs.map((ix: any) => this.kitIxToSerialized(ix)).map(ix => this.makeAtaIdempotent(ix));
  }

  /**
   * Get wallet positions across all active Kamino vaults using SDK
   */
  async getWalletPositions(walletAddress: string): Promise<{ vaultAddress: string; mint: string; amount: string }[]> {
    try {
      const vaults = await this.db.getActiveVaults(EarnTokenType.KAMINO);
      if (vaults.length === 0) return [];

      const positions = await Promise.all(
        vaults.map(async (vault) => {
          try {
            const kaminoVault = new KaminoVault(this.kaminoRpc, kaminoAddress(vault.vaultAddress!));
            const shares = await kaminoVault.getUserShares(kaminoAddress(walletAddress));
            if (shares.totalShares.lte(0)) return null;

            const exchangeRate = await kaminoVault.getExchangeRate();
            const tokenDecimals = vault.kaminoToken?.state?.tokenMintDecimals ?? 6;
            const underlyingAmount = shares.totalShares
              .mul(exchangeRate)
              .mul(new Decimal(10).pow(tokenDecimals))
              .floor();

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
   * Get an unsigned deposit transaction using klend-sdk
   * @param vaultAddress Kamino vault address (kvault)
   * @param amount Amount in decimal format (e.g. "0.1")
   * @param walletAddress Wallet address
   */
  async deposit(vaultAddress: string, amount: string, walletAddress: string): Promise<string> {
    try {
      const vault = new KaminoVault(this.kaminoRpc, kaminoAddress(vaultAddress));
      const signer = createKaminoNoopSigner(walletAddress);

      const depositResult = await vault.depositIxs(signer, new Decimal(amount));

      const allIxs = [
        ...depositResult.depositIxs,
        ...depositResult.stakeInFarmIfNeededIxs,
      ];

      // Get vault state for LUT address
      const vaultState = await vault.getState();
      return await this.buildTransaction(allIxs as any, walletAddress, vaultState.vaultLookupTable as unknown as string);
    } catch (error) {
      console.error('Error creating Kamino deposit transaction:', error);
      throw error;
    }
  }

  /**
   * Get an unsigned withdraw transaction using klend-sdk
   * @param vaultAddress Kamino vault address (kvault)
   * @param amount Amount in decimal format (e.g. "0.1") — underlying token amount
   * @param walletAddress Wallet address
   */
  async withdraw(vaultAddress: string, amount: string, walletAddress: string): Promise<string> {
    try {
      const vault = new KaminoVault(this.kaminoRpc, kaminoAddress(vaultAddress));
      const signer = createKaminoNoopSigner(walletAddress);

      // Convert underlying token amount to share amount
      const exchangeRate = await vault.getExchangeRate();
      const shareAmount = new Decimal(amount).div(exchangeRate);

      const withdrawResult = await vault.withdrawIxs(signer, shareAmount);

      const allIxs = [
        ...withdrawResult.unstakeFromFarmIfNeededIxs,
        ...withdrawResult.withdrawIxs,
        ...withdrawResult.postWithdrawIxs,
      ];

      // Get vault state for LUT address
      const vaultState = await vault.getState();
      return await this.buildTransaction(allIxs as any, walletAddress, vaultState.vaultLookupTable as unknown as string);
    } catch (error) {
      console.error('Error creating Kamino withdraw transaction:', error);
      throw error;
    }
  }

  /**
   * Convert non-idempotent CreateAssociatedTokenAccount to idempotent.
   * Kamino SDK may return non-idempotent ATA creates that fail with IllegalOwner
   * if the account already exists (e.g. from a previous deposit).
   */
  private makeAtaIdempotent(ix: SerializedInstruction): SerializedInstruction {
    const ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
    if (ix.programId === ATA_PROGRAM_ID && Buffer.from(ix.data, 'base64').length === 0) {
      console.log('[KaminoManager] Converting non-idempotent ATA create → idempotent');
      return { ...ix, data: Buffer.from([1]).toString('base64') };
    }
    return ix;
  }

  private kitIxToSerialized(ix: any): SerializedInstruction {
    return {
      programId: ix.programAddress as string,
      accounts: (ix.accounts ?? []).map((acc: any) => ({
        pubkey: acc.address as string,
        isSigner: acc.role === AccountRole.WRITABLE_SIGNER || acc.role === AccountRole.READONLY_SIGNER,
        isWritable: acc.role === AccountRole.WRITABLE_SIGNER || acc.role === AccountRole.WRITABLE,
      })),
      data: Buffer.from(ix.data ?? new Uint8Array()).toString('base64'),
    };
  }

  /**
   * Build a base64-encoded unsigned versioned transaction from instructions,
   * optionally compressing with the vault's address lookup table
   */
  private async buildTransaction(instructions: Instruction[], feePayer: string, lutAddress?: string): Promise<string> {
    const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();

    const baseMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayer(address(feePayer), tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (tx) => instructions.reduce((msg: any, ix) => appendTransactionMessageInstruction(ix, msg), tx),
    );

    // Compress using vault's address lookup table if available
    let transactionMessage = baseMessage;
    if (lutAddress) {
      try {
        const lutAddr = address(lutAddress);
        const addressesByLut = await fetchAddressesForLookupTables([lutAddr], this.rpc);
        if (addressesByLut[lutAddr]?.length > 0) {
          transactionMessage = compressTransactionMessageUsingAddressLookupTables(
            baseMessage,
            addressesByLut,
          ) as typeof baseMessage;
        }
      } catch (err) {
        console.warn('[Kamino] Failed to fetch LUT, sending without compression:', err);
      }
    }

    const compiled = compileTransaction(transactionMessage);
    return getBase64EncodedWireTransaction(compiled);
  }
}

export default KaminoManager;
