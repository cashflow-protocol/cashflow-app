import axios, { AxiosInstance } from 'axios';
import Decimal from 'decimal.js';
import { createSolanaRpc, AccountRole } from '@solana/kit';
import type { Rpc, SolanaRpcApi } from '@solana/kit';
import {
  createSolanaRpc as createKaminoRpc,
  address as kaminoAddress,
} from '@kamino-finance/klend-sdk/node_modules/@solana/kit';
import {
  KaminoMarket,
  MultiplyObligation,
  ObligationTypeTag,
  getDepositWithLeverageIxs,
  getWithdrawWithLeverageIxs,
  getScopeRefreshIxForObligationAndReserves,
} from '@kamino-finance/klend-sdk';
import { EarnTokenType } from '../types';
import type { SerializedInstruction } from '../types';
import { MULTIPLY_POOLS, MULTIPLY_POOL_BY_ID, MULTIPLY_COLLATERAL_INFO, MultiplyPool } from '../constants/multiplyPools';
import { ASSOCIATED_TOKEN_PROGRAM_ID } from '../constants';
import { DBManager, EarnTokenUpsert } from './DBManager';
import { JupiterManager } from './JupiterManager';

export interface MultiplyPositionResult {
  poolId: string;
  collMint: string;
  debtMint: string;
  defaultDepositMint: string;
  /** Collateral amount in raw lamports (coll mint decimals). */
  collAmount: string;
  /** Debt amount in raw lamports (debt mint decimals). */
  debtAmount: string;
  /** USD market values from refreshed obligation stats. */
  collValueUsd: number;
  debtValueUsd: number;
  netEquityUsd: number;
  /** Net equity expressed in raw lamports of `defaultDepositMint`. */
  netEquityRaw: string;
  currentLeverage: number;
  liquidationLtv: number;
  healthFactor: number;
}

export interface MultiplyIxsResult {
  instructions: SerializedInstruction[];
  lookupTables: string[];
}

const RECENT_SLOT_DURATION_MS = 450;
const MARKET_CACHE_TTL_MS = 60_000;

interface KaminoReserveMetrics {
  reserve: string;
  liquidityToken: { symbol: string; mint: string; decimals: number };
  liquidityTokenMint: string;
  supplyApy: string;
  borrowApy: string;
  totalSupplyUsd: string;
  totalBorrowUsd: string;
  maxLtv: string;
  liquidationLtv: string;
}

interface KaminoStakingYield {
  tokenMint: string;
  apy: string;
}

interface KaminoLut {
  address: string;
  productType: string;
}

const METRICS_TTL_MS = 30_000;

export class KaminoMultiplyManager {
  private api: AxiosInstance;
  protected rpc: Rpc<SolanaRpcApi>;
  protected kaminoRpc: any;
  private db: DBManager;
  private jupiter: JupiterManager;
  protected readonly baseURL = 'https://api.kamino.finance';

  private reserveCache: Map<string, { ts: number; data: KaminoReserveMetrics[] }> = new Map();
  private stakingYieldCache: { ts: number; data: KaminoStakingYield[] } | null = null;
  private productLutCache: { ts: number; data: string[] } | null = null;
  private marketCache: Map<string, { ts: number; market: KaminoMarket }> = new Map();

  constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.rpc = createSolanaRpc(rpcUrl);
    this.kaminoRpc = createKaminoRpc(rpcUrl);
    this.db = new DBManager();
    this.jupiter = new JupiterManager();
    this.api = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** Cron entry point — refresh all pool metrics and upsert EarnToken rows. */
  async getEarnTokens(): Promise<void> {
    try {
      const stakingYields = await this.fetchStakingYields();
      const productLuts = await this.fetchProductLuts();
      const upserts: EarnTokenUpsert[] = [];

      for (const pool of MULTIPLY_POOLS) {
        try {
          const upsert = await this.buildUpsertForPool(pool, stakingYields, productLuts);
          if (upsert) upserts.push(upsert);
        } catch (err) {
          console.error(`[KaminoMultiply] Failed to build upsert for ${pool.id}:`, err);
        }
      }

      if (upserts.length > 0) {
        await this.db.upsertEarnTokens(upserts);
      }
      console.log(`[KaminoMultiply] Upserted ${upserts.length} multiply pools`);
    } catch (err) {
      console.error('[KaminoMultiply] getEarnTokens failed:', err);
      throw err;
    }
  }

  private async buildUpsertForPool(
    pool: MultiplyPool,
    stakingYields: KaminoStakingYield[],
    productLuts: string[],
  ): Promise<EarnTokenUpsert | null> {
    const reserves = await this.fetchReserveMetrics(pool.market);
    const collReserve = reserves.find((r) => r.liquidityTokenMint === pool.collMint);
    const debtReserve = reserves.find((r) => r.liquidityTokenMint === pool.debtMint);

    if (!collReserve || !debtReserve) {
      console.warn(`[KaminoMultiply] Missing reserve metrics for ${pool.id}`);
      return null;
    }

    const stakingApy =
      stakingYields.find((s) => s.tokenMint === pool.collMint)?.apy ?? '0';

    const collateralApy = parseFloat(collReserve.supplyApy) + parseFloat(stakingApy);
    const borrowApy = parseFloat(debtReserve.borrowApy);
    const liquidationLtv = parseFloat(collReserve.liquidationLtv);

    const apyAtDefault = computeNetApy(collateralApy, borrowApy, pool.defaultLeverage);

    // rewardsRate convention used elsewhere: APY × 10_000 (so 8% → 800 → "8.00%")
    const rewardsRate = apyAtDefault * 10_000;

    const multiply = {
      collMint: pool.collMint,
      collSymbol: pool.collSymbol,
      collDecimals: pool.collDecimals,
      collLogoUrl: MULTIPLY_COLLATERAL_INFO[pool.collMint]?.logoUrl,
      debtMint: pool.debtMint,
      debtSymbol: pool.debtSymbol,
      debtDecimals: pool.debtDecimals,
      defaultDepositMint: pool.defaultDepositMint,
      leverageRange: {
        min: pool.minLeverage,
        max: pool.maxLeverage,
        default: pool.defaultLeverage,
      },
      apyAtDefault,
      liquidationLtv,
    };

    const protocolData = {
      poolId: pool.id,
      market: pool.market,
      collReserve: collReserve.reserve,
      debtReserve: debtReserve.reserve,
      maxLtv: collReserve.maxLtv,
      liquidationLtv,
      supplyApy: collReserve.supplyApy,
      borrowApy: debtReserve.borrowApy,
      stakingApy,
      collateralApy,
      apyByLeverage: buildLeverageSamples(collateralApy, borrowApy, pool),
      elevationGroup: pool.elevationGroup ?? 0,
      lookupTables: productLuts,
      lastFetchedAt: Date.now(),
    };

    return {
      type: EarnTokenType.KAMINO_MULTIPLY,
      mint: pool.defaultDepositMint,
      vaultAddress: pool.id,
      vaultTitle: pool.title,
      symbol: deriveSymbolForMint(pool.defaultDepositMint),
      rewardsRate,
      minDepositAmount: pool.minDepositAmount,
      minWithdrawAmount: pool.minWithdrawAmount,
      minAppBuild: pool.minAppBuild,
      categories: pool.categories,
      protocolData,
      protocolName: 'Kamino',
      multiply,
    };
  }

  private async fetchReserveMetrics(market: string): Promise<KaminoReserveMetrics[]> {
    const cached = this.reserveCache.get(market);
    if (cached && Date.now() - cached.ts < METRICS_TTL_MS) {
      return cached.data;
    }
    const response = await this.api.get<KaminoReserveMetrics[]>(
      `/kamino-market/${market}/reserves/metrics`,
    );
    this.reserveCache.set(market, { ts: Date.now(), data: response.data });
    return response.data;
  }

  private async fetchStakingYields(): Promise<KaminoStakingYield[]> {
    if (this.stakingYieldCache && Date.now() - this.stakingYieldCache.ts < METRICS_TTL_MS) {
      return this.stakingYieldCache.data;
    }
    try {
      const response = await this.api.get<KaminoStakingYield[]>('/v2/staking-yields');
      this.stakingYieldCache = { ts: Date.now(), data: response.data };
      return response.data;
    } catch (err) {
      console.warn('[KaminoMultiply] Failed to fetch staking yields:', err);
      return this.stakingYieldCache?.data ?? [];
    }
  }

  private async fetchProductLuts(): Promise<string[]> {
    if (this.productLutCache && Date.now() - this.productLutCache.ts < 5 * 60 * 1000) {
      return this.productLutCache.data;
    }
    try {
      const response = await this.api.get<KaminoLut[] | string[]>(
        '/luts/managed/product-type/multiply',
      );
      const luts = Array.isArray(response.data)
        ? response.data.map((entry: any) => (typeof entry === 'string' ? entry : entry.address))
        : [];
      this.productLutCache = { ts: Date.now(), data: luts };
      return luts;
    } catch (err) {
      console.warn('[KaminoMultiply] Failed to fetch product LUTs:', err);
      return this.productLutCache?.data ?? [];
    }
  }

  /** Clamp + look up a pool config from a `vaultAddress` (synthetic pool ID). */
  protected getPool(poolId: string): MultiplyPool {
    const pool = MULTIPLY_POOL_BY_ID[poolId];
    if (!pool) throw new Error(`Unknown Multiply pool: ${poolId}`);
    return pool;
  }

  // ---- Positions ----------------------------------------------------------

  async getWalletPositions(walletAddress: string): Promise<MultiplyPositionResult[]> {
    const results: MultiplyPositionResult[] = [];
    for (const pool of MULTIPLY_POOLS) {
      try {
        const position = await this.getPoolPositionForWallet(pool, walletAddress);
        if (position) results.push(position);
      } catch (err) {
        console.warn(`[KaminoMultiply] position fetch failed for ${pool.id}:`, err);
      }
    }
    return results;
  }

  private async getPoolPositionForWallet(
    pool: MultiplyPool,
    walletAddress: string,
  ): Promise<MultiplyPositionResult | null> {
    const market = await this.loadMarket(pool.market);
    const obligationType = new MultiplyObligation(
      kaminoAddress(pool.collMint),
      kaminoAddress(pool.debtMint),
      market.programId,
    );
    const obligation = await market.getObligationByWallet(
      kaminoAddress(walletAddress) as any,
      obligationType as any,
    );
    if (!obligation) return null;

    const deposits = obligation.getDeposits();
    const borrows = obligation.getBorrows();
    if (deposits.length === 0 && borrows.length === 0) return null;

    const collDeposit = deposits.find((d) => String(d.mintAddress) === pool.collMint);
    const debtBorrow = borrows.find((b) => String(b.mintAddress) === pool.debtMint);

    const collAmount = collDeposit?.amount.toFixed(0) ?? '0';
    const debtAmount = debtBorrow?.amount.toFixed(0) ?? '0';
    const collValueUsd = collDeposit?.marketValueRefreshed.toNumber() ?? 0;
    const debtValueUsd = debtBorrow?.marketValueRefreshed.toNumber() ?? 0;
    const netEquityUsd = collValueUsd - debtValueUsd;

    const currentLeverage = netEquityUsd > 0 ? collValueUsd / netEquityUsd : 0;
    const stats: any = obligation.refreshedStats;
    const liquidationLtv = Number(stats?.liquidationLtv ?? 0);
    const healthFactor = liquidationLtv > 0 ? liquidationLtv / Math.max(currentLeverage, 1e-9) : 0;

    // Convert net equity USD → raw lamports of the default deposit mint.
    // Use the supply reserve's price for the deposit mint (matches what the obligation refresh used).
    const depositMintAddr = kaminoAddress(pool.defaultDepositMint);
    const depositReserve = market.getReserveByMint(depositMintAddr);
    const depositDecimals =
      pool.defaultDepositMint === pool.collMint ? pool.collDecimals : pool.debtDecimals;
    let depositTokenPrice = 1;
    try {
      depositTokenPrice = depositReserve?.getOracleMarketPrice().toNumber() ?? 1;
    } catch {
      depositTokenPrice = 1;
    }
    const netEquityInDepositTokens = depositTokenPrice > 0 ? netEquityUsd / depositTokenPrice : 0;
    const netEquityRaw = new Decimal(netEquityInDepositTokens)
      .mul(new Decimal(10).pow(depositDecimals))
      .floor()
      .toFixed(0);

    return {
      poolId: pool.id,
      collMint: pool.collMint,
      debtMint: pool.debtMint,
      defaultDepositMint: pool.defaultDepositMint,
      collAmount,
      debtAmount,
      collValueUsd,
      debtValueUsd,
      netEquityUsd,
      netEquityRaw,
      currentLeverage,
      liquidationLtv,
      healthFactor,
    };
  }

  // ---- Deposit / Withdraw -------------------------------------------------

  async getDepositInstructions(
    poolId: string,
    depositMint: string,
    amountRaw: string,
    leverage: number,
    ownerAddress: string,
    slippageBps?: number,
  ): Promise<MultiplyIxsResult> {
    const pool = this.getPool(poolId);
    if (depositMint !== pool.collMint && depositMint !== pool.debtMint) {
      throw new Error(`depositMint ${depositMint} not part of pool ${poolId}`);
    }
    const market = await this.loadMarket(pool.market);
    const collReserve = market.getReserveByMint(kaminoAddress(pool.collMint));
    const debtReserve = market.getReserveByMint(kaminoAddress(pool.debtMint));
    if (!collReserve || !debtReserve) throw new Error(`Reserves missing for pool ${poolId}`);

    const owner = this.createKaminoNoopSigner(ownerAddress);
    const obligationType = new MultiplyObligation(
      kaminoAddress(pool.collMint),
      kaminoAddress(pool.debtMint),
      market.programId,
    );
    const existing = await market.getObligationByWallet(
      kaminoAddress(ownerAddress) as any,
      obligationType as any,
    );

    const depositDecimals =
      depositMint === pool.collMint ? pool.collDecimals : pool.debtDecimals;
    const depositAmount = new Decimal(amountRaw).div(new Decimal(10).pow(depositDecimals));

    const priceDebtToColl = this.computePriceDebtToColl(market, pool);

    const currentSlot = await this.getCurrentSlot();
    const scopeRefreshIx = await getScopeRefreshIxForObligationAndReserves(
      market,
      collReserve,
      debtReserve,
      existing ?? obligationType,
      undefined,
    );

    const { quoter, swapper } = this.jupiter.getKlendSwapAdapter({
      ownerAddress,
      slippageBps: slippageBps ?? pool.defaultSlippageBps,
    });

    const effectiveSlippagePct = new Decimal((slippageBps ?? pool.defaultSlippageBps) / 100);

    const results = await getDepositWithLeverageIxs<any>({
      owner: owner as any,
      kaminoMarket: market,
      debtTokenMint: kaminoAddress(pool.debtMint),
      collTokenMint: kaminoAddress(pool.collMint),
      depositAmount,
      priceDebtToColl,
      slippagePct: effectiveSlippagePct,
      obligation: existing,
      referrer: { __option: 'None' } as any,
      currentSlot,
      targetLeverage: new Decimal(leverage),
      selectedTokenMint: kaminoAddress(depositMint),
      obligationTypeTagOverride: ObligationTypeTag.Multiply,
      scopeRefreshIx,
      quoteBufferBps: new Decimal(50),
      quoter,
      swapper,
      useV2Ixs: true,
      elevationGroupOverride: pool.elevationGroup,
    });

    if (results.length === 0) throw new Error('klend returned no deposit ix candidates');
    const chosen = results[0];
    return this.toMultiplyIxsResult(pool, chosen.ixs, chosen.lookupTables);
  }

  async getWithdrawInstructions(
    poolId: string,
    withdrawMint: string,
    amountRaw: string,
    isClosingPosition: boolean,
    ownerAddress: string,
    slippageBps?: number,
  ): Promise<MultiplyIxsResult> {
    const pool = this.getPool(poolId);
    if (withdrawMint !== pool.collMint && withdrawMint !== pool.debtMint) {
      throw new Error(`withdrawMint ${withdrawMint} not part of pool ${poolId}`);
    }
    const market = await this.loadMarket(pool.market);
    const collReserve = market.getReserveByMint(kaminoAddress(pool.collMint));
    const debtReserve = market.getReserveByMint(kaminoAddress(pool.debtMint));
    if (!collReserve || !debtReserve) throw new Error(`Reserves missing for pool ${poolId}`);

    const owner = this.createKaminoNoopSigner(ownerAddress);
    const obligationType = new MultiplyObligation(
      kaminoAddress(pool.collMint),
      kaminoAddress(pool.debtMint),
      market.programId,
    );
    const obligation = await market.getObligationByWallet(
      kaminoAddress(ownerAddress) as any,
      obligationType as any,
    );
    if (!obligation) throw new Error(`No open ${poolId} position for ${ownerAddress}`);

    const collPos = obligation.getDeposits().find((d) => String(d.mintAddress) === pool.collMint);
    const debtPos = obligation.getBorrows().find((b) => String(b.mintAddress) === pool.debtMint);
    const deposited = collPos?.amount ?? new Decimal(0);
    const borrowed = debtPos?.amount ?? new Decimal(0);

    const withdrawDecimals =
      withdrawMint === pool.collMint ? pool.collDecimals : pool.debtDecimals;
    const withdrawAmount = new Decimal(amountRaw).div(new Decimal(10).pow(withdrawDecimals));

    const priceCollToDebt = this.computePriceCollToDebt(market, pool);

    const currentSlot = await this.getCurrentSlot();
    const scopeRefreshIx = await getScopeRefreshIxForObligationAndReserves(
      market,
      collReserve,
      debtReserve,
      obligation,
      undefined,
    );

    const { quoter, swapper } = this.jupiter.getKlendSwapAdapter({
      ownerAddress,
      slippageBps: slippageBps ?? pool.defaultSlippageBps,
    });

    const userSolBalanceLamports = await this.getUserSolBalanceLamports(ownerAddress);

    const results = await getWithdrawWithLeverageIxs<any>({
      owner: owner as any,
      kaminoMarket: market,
      debtTokenMint: kaminoAddress(pool.debtMint),
      collTokenMint: kaminoAddress(pool.collMint),
      obligation,
      deposited,
      borrowed,
      referrer: { __option: 'None' } as any,
      currentSlot,
      withdrawAmount,
      priceCollToDebt,
      slippagePct: new Decimal((slippageBps ?? pool.defaultSlippageBps) / 100),
      isClosingPosition,
      selectedTokenMint: kaminoAddress(withdrawMint),
      scopeRefreshIx,
      quoteBufferBps: new Decimal(50),
      quoter,
      swapper,
      useV2Ixs: true,
      userSolBalanceLamports,
    });

    if (results.length === 0) throw new Error('klend returned no withdraw ix candidates');
    const chosen = results[0];
    return this.toMultiplyIxsResult(pool, chosen.ixs, chosen.lookupTables);
  }

  // ---- Helpers ------------------------------------------------------------

  private async loadMarket(marketAddress: string): Promise<KaminoMarket> {
    const cached = this.marketCache.get(marketAddress);
    if (cached && Date.now() - cached.ts < MARKET_CACHE_TTL_MS) {
      return cached.market;
    }
    const market = await KaminoMarket.load(
      this.kaminoRpc,
      kaminoAddress(marketAddress),
      RECENT_SLOT_DURATION_MS,
      undefined,
      true,
    );
    if (!market) throw new Error(`KaminoMarket.load returned null for ${marketAddress}`);
    this.marketCache.set(marketAddress, { ts: Date.now(), market });
    return market;
  }

  private createKaminoNoopSigner(walletAddr: string): any {
    return {
      address: kaminoAddress(walletAddr),
      signTransactions: async (txs: any[]) => txs.map(() => ({})),
    };
  }

  private async getCurrentSlot(): Promise<bigint> {
    const slot = await this.rpc.getSlot().send();
    return slot;
  }

  private async getUserSolBalanceLamports(walletAddress: string): Promise<number> {
    try {
      const { value } = await this.rpc
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .getBalance(walletAddress as any)
        .send();
      return Number(value);
    } catch {
      return 0;
    }
  }

  private computePriceDebtToColl(market: KaminoMarket, pool: MultiplyPool): Decimal {
    const collReserve = market.getReserveByMint(kaminoAddress(pool.collMint));
    const debtReserve = market.getReserveByMint(kaminoAddress(pool.debtMint));
    if (!collReserve || !debtReserve) return new Decimal(1);
    const collPrice = collReserve.getOracleMarketPrice();
    const debtPrice = debtReserve.getOracleMarketPrice();
    if (collPrice.lte(0)) return new Decimal(1);
    return debtPrice.div(collPrice);
  }

  private computePriceCollToDebt(market: KaminoMarket, pool: MultiplyPool): Decimal {
    const collReserve = market.getReserveByMint(kaminoAddress(pool.collMint));
    const debtReserve = market.getReserveByMint(kaminoAddress(pool.debtMint));
    if (!collReserve || !debtReserve) return new Decimal(1);
    const collPrice = collReserve.getOracleMarketPrice();
    const debtPrice = debtReserve.getOracleMarketPrice();
    if (debtPrice.lte(0)) return new Decimal(1);
    return collPrice.div(debtPrice);
  }

  /** Convert klend kit instructions to serialized form + flatten LUT addresses. */
  private toMultiplyIxsResult(pool: MultiplyPool, ixs: any[], lutAccounts: any[]): MultiplyIxsResult {
    const instructions = ixs
      .map((ix) => this.kitIxToSerialized(ix))
      .map((ix) => this.makeAtaIdempotent(ix));

    // Combine: klend's per-tx LUTs + pool's product LUTs (from cron blob).
    const lutAddresses = new Set<string>();
    for (const acc of lutAccounts) {
      const addr = (acc?.address ?? '').toString();
      if (addr) lutAddresses.add(addr);
    }
    const productLuts = this.productLutCache?.data ?? [];
    for (const addr of productLuts) lutAddresses.add(addr);

    return { instructions, lookupTables: Array.from(lutAddresses) };
  }

  private kitIxToSerialized(ix: any): SerializedInstruction {
    return {
      programId: String(ix.programAddress),
      accounts: (ix.accounts ?? []).map((acc: any) => ({
        pubkey: String(acc.address),
        isSigner: acc.role === AccountRole.WRITABLE_SIGNER || acc.role === AccountRole.READONLY_SIGNER,
        isWritable: acc.role === AccountRole.WRITABLE_SIGNER || acc.role === AccountRole.WRITABLE,
      })),
      data: Buffer.from(ix.data ?? new Uint8Array()).toString('base64'),
    };
  }

  private makeAtaIdempotent(ix: SerializedInstruction): SerializedInstruction {
    if (ix.programId === ASSOCIATED_TOKEN_PROGRAM_ID && Buffer.from(ix.data, 'base64').length === 0) {
      return { ...ix, data: Buffer.from([1]).toString('base64') };
    }
    return ix;
  }
}

/** Net APY for a leveraged loop, at the given leverage multiplier. */
export function computeNetApy(collateralApy: number, borrowApy: number, leverage: number): number {
  return collateralApy * leverage - borrowApy * (leverage - 1);
}

function buildLeverageSamples(
  collateralApy: number,
  borrowApy: number,
  pool: MultiplyPool,
): Record<string, number> {
  const samples: Record<string, number> = {};
  const step = 0.5;
  for (let l = pool.minLeverage; l <= pool.maxLeverage + 1e-6; l += step) {
    const key = l.toFixed(1);
    samples[key] = computeNetApy(collateralApy, borrowApy, l);
  }
  return samples;
}

function deriveSymbolForMint(mint: string): string {
  // Imported lazily to avoid a circular import via constants/index.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { SUPPORTED_TOKENS_BY_MINT } = require('../constants/tokens');
  return SUPPORTED_TOKENS_BY_MINT[mint]?.symbol ?? '';
}

export default KaminoMultiplyManager;
