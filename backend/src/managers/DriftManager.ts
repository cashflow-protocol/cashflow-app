import { Connection, Keypair } from '@solana/web3.js';
import {
  DriftClient,
  Wallet,
  loadKeypair,
  initialize,
  BulkAccountLoader,
  calculateDepositRate,
  SpotMarketAccount,
  decodeName,
  SPOT_MARKET_RATE_PRECISION,
  getMarketsAndOraclesForSubscription,
} from '@drift-labs/sdk';
import { EarnTokenModel } from '../models';
import { SUPPORTED_TOKEN_MINTS, SUPPORTED_TOKENS_BY_MINT } from '../constants';

interface DriftSpotMarketData {
  marketIndex: number;
  name: string;
  mint: string;
  pubkey: string;
  depositRate: number;
  rawAccount: Record<string, any>;
}

export class DriftManager {
  private driftClient: DriftClient;
  private connection: Connection;
  private initialized: boolean = false;

  constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL;
    const privateKey = process.env.DRIFT_PRIVATE_KEY;

    if (!rpcUrl) {
      throw new Error('SOLANA_RPC_URL environment variable is required for DriftManager');
    }
    if (!privateKey) {
      throw new Error('DRIFT_PRIVATE_KEY environment variable is required for DriftManager');
    }

    this.connection = new Connection(rpcUrl, { commitment: 'confirmed' });

    const keypair = loadKeypair(privateKey);
    const wallet = new Wallet(keypair);

    initialize({ env: 'mainnet-beta' });

    const { perpMarketIndexes, spotMarketIndexes, oracleInfos } =
      getMarketsAndOraclesForSubscription('mainnet-beta');

    const accountLoader = new BulkAccountLoader(this.connection, 'confirmed', 60_000);

    this.driftClient = new DriftClient({
      connection: this.connection,
      wallet,
      env: 'mainnet-beta',
      accountSubscription: {
        type: 'polling',
        accountLoader,
      },
      perpMarketIndexes,
      spotMarketIndexes,
      oracleInfos,
    });
  }

  /**
   * Initialize the DriftClient by subscribing to on-chain accounts.
   * Must be called once before getEarnTokens().
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      console.log('🔄 [Drift] Initializing DriftClient...');
      const success = await this.driftClient.subscribe();
      if (!success) {
        throw new Error('DriftClient.subscribe() returned false');
      }
      this.initialized = true;
      console.log('✅ [Drift] DriftClient initialized and subscribed');
    } catch (error) {
      console.error('❌ [Drift] Failed to initialize DriftClient:', error);
      throw error;
    }
  }

  /**
   * Fetch deposit rates from Drift spot markets and save to database.
   */
  async getEarnTokens(): Promise<DriftSpotMarketData[]> {
    if (!this.initialized) {
      throw new Error('DriftManager not initialized. Call initialize() first.');
    }

    try {
      const spotMarkets = this.driftClient.getSpotMarketAccounts();

      const supportedMarkets: DriftSpotMarketData[] = spotMarkets
        .filter((market) => SUPPORTED_TOKEN_MINTS.includes(market.mint.toBase58()))
        .map((market) => {
          const depositRate = calculateDepositRate(market);
          const depositRateDecimal =
            depositRate.toNumber() / SPOT_MARKET_RATE_PRECISION.toNumber();

          return {
            marketIndex: market.marketIndex,
            name: decodeName(market.name),
            mint: market.mint.toBase58(),
            pubkey: market.pubkey.toBase58(),
            depositRate: depositRateDecimal,
            rawAccount: this.serializeSpotMarket(market),
          };
        });

      console.log(
        `Drift: found ${supportedMarkets.length} supported spot markets out of ${spotMarkets.length} total`
      );

      await this.saveTokensToDatabase(supportedMarkets);

      return supportedMarkets;
    } catch (error) {
      console.error('Error fetching Drift earn tokens:', error);
      throw error;
    }
  }

  private serializeSpotMarket(market: SpotMarketAccount): Record<string, any> {
    return {
      marketIndex: market.marketIndex,
      name: decodeName(market.name),
      mint: market.mint.toBase58(),
      pubkey: market.pubkey.toBase58(),
      vault: market.vault.toBase58(),
      oracle: market.oracle.toBase58(),
      decimals: market.decimals,
      depositBalance: market.depositBalance.toString(),
      borrowBalance: market.borrowBalance.toString(),
      cumulativeDepositInterest: market.cumulativeDepositInterest.toString(),
      cumulativeBorrowInterest: market.cumulativeBorrowInterest.toString(),
      optimalUtilization: market.optimalUtilization,
      optimalBorrowRate: market.optimalBorrowRate,
      maxBorrowRate: market.maxBorrowRate,
      maxTokenDeposits: market.maxTokenDeposits.toString(),
      lastInterestTs: market.lastInterestTs.toString(),
      ordersEnabled: market.ordersEnabled,
    };
  }

  private async saveTokensToDatabase(markets: DriftSpotMarketData[]): Promise<void> {
    try {
      const bulkOps = markets.map((market) => {
        const symbol = SUPPORTED_TOKENS_BY_MINT[market.mint]?.symbol ?? '';

        return {
          updateOne: {
            filter: {
              type: 'drift' as const,
              mint: market.mint,
              vaultAddress: market.pubkey,
            },
            update: {
              $set: {
                type: 'drift' as const,
                mint: market.mint,
                vaultAddress: market.pubkey,
                vaultTitle: `Drift - ${symbol}`,
                symbol,
                rewardsRate: market.depositRate * 10000,
                driftToken: market.rawAccount,
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
        console.log('⚠️ [Drift] No supported spot markets to save');
        return;
      }

      const result = await EarnTokenModel.bulkWrite(bulkOps as any);

      console.log(
        `✅ [Drift] Saved ${result.upsertedCount} new tokens, updated ${result.modifiedCount} existing tokens`
      );
    } catch (error) {
      console.error('Error saving Drift tokens to database:', error);
      throw error;
    }
  }
}

export default DriftManager;
