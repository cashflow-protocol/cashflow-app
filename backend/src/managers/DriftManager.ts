import { Connection, Keypair, PublicKey, TransactionInstruction, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import {
  DriftClient,
  Wallet,
  loadKeypair,
  initialize,
  BulkAccountLoader,
  calculateDepositRate,
  SpotMarketAccount,
  decodeName,
  encodeName,
  SPOT_MARKET_RATE_PRECISION,
  getMarketsAndOraclesForSubscription,
  getUserAccountPublicKeySync,
  getUserStatsAccountPublicKey,
  getDriftSignerPublicKey,
  getTokenProgramForSpotMarket,
  getTokenAmount,
  UserAccount,
  BN,
} from '@drift-labs/sdk';
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
  AccountRole,
} from '@solana/kit';
import type { Rpc, SolanaRpcApi } from '@solana/kit';
import { SUPPORTED_TOKEN_MINTS, SUPPORTED_TOKENS_BY_MINT } from '../constants';
import { EarnTokenType } from '../types';
import { DBManager, EarnTokenUpsert } from './DBManager';

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

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
  private rpc: Rpc<SolanaRpcApi>;
  private db: DBManager;
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
    this.rpc = createSolanaRpc(rpcUrl);
    this.db = new DBManager();

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

  /**
   * Get an unsigned deposit transaction for Drift
   * @param vaultAddress Spot market pubkey (stored as vaultAddress in DB)
   * @param amount Amount in raw token units (e.g. "100000" for 0.1 USDC)
   * @param walletAddress User's wallet address
   */
  async deposit(vaultAddress: string, amount: string, walletAddress: string): Promise<string> {
    const userPubkey = new PublicKey(walletAddress);
    const spotMarket = this.getSpotMarketByVaultAddress(vaultAddress);
    const tokenProgramId = getTokenProgramForSpotMarket(spotMarket);
    const programId = this.driftClient.program.programId;

    const userAccountPubkey = getUserAccountPublicKeySync(programId, userPubkey, 0);
    const userStatsPubkey = getUserStatsAccountPublicKey(programId, userPubkey);
    const ata = this.getAssociatedTokenAddress(spotMarket.mint, userPubkey, tokenProgramId);
    const bnAmount = new BN(amount);

    const instructions: TransactionInstruction[] = [];

    // Check if user has a Drift account, initialize if not
    const userAccountInfo = await this.connection.getAccountInfo(userAccountPubkey);
    const userInitialized = userAccountInfo !== null;

    if (!userInitialized) {
      const userStatsInfo = await this.connection.getAccountInfo(userStatsPubkey);
      if (!userStatsInfo) {
        const initStatsIx = await this.driftClient.program.methods
          .initializeUserStats()
          .accounts({
            userStats: userStatsPubkey,
            authority: userPubkey,
            payer: userPubkey,
            rent: SYSVAR_RENT_PUBKEY,
            systemProgram: SystemProgram.programId,
            state: await this.driftClient.getStatePublicKey(),
          })
          .instruction();
        instructions.push(initStatsIx);
      }

      const initUserIx = await this.driftClient.program.methods
        .initializeUser(0, encodeName('Main Account'))
        .accounts({
          user: userAccountPubkey,
          userStats: userStatsPubkey,
          authority: userPubkey,
          payer: userPubkey,
          rent: SYSVAR_RENT_PUBKEY,
          systemProgram: SystemProgram.programId,
          state: await this.driftClient.getStatePublicKey(),
        })
        .instruction();
      instructions.push(initUserIx);
    }

    // Build remaining accounts
    const remainingAccounts = userInitialized
      ? this.driftClient.getRemainingAccounts({
          userAccounts: [await this.driftClient.program.account.user.fetch(userAccountPubkey) as UserAccount],
          writableSpotMarketIndexes: [spotMarket.marketIndex],
        })
      : this.driftClient.getRemainingAccounts({
          userAccounts: [],
          writableSpotMarketIndexes: [spotMarket.marketIndex],
        });

    this.driftClient.addTokenMintToRemainingAccounts(spotMarket, remainingAccounts);
    if (this.driftClient.isTransferHook(spotMarket)) {
      await this.driftClient.addExtraAccountMetasToRemainingAccounts(spotMarket.mint, remainingAccounts);
    }

    // Build deposit instruction
    const depositIx = await this.driftClient.program.methods
      .deposit(spotMarket.marketIndex, bnAmount, false)
      .accounts({
        state: await this.driftClient.getStatePublicKey(),
        spotMarket: spotMarket.pubkey,
        spotMarketVault: spotMarket.vault,
        user: userAccountPubkey,
        userStats: userStatsPubkey,
        userTokenAccount: ata,
        authority: userPubkey,
        tokenProgram: tokenProgramId,
      })
      .remainingAccounts(remainingAccounts)
      .instruction();
    instructions.push(depositIx);

    return this.buildTransaction(instructions, walletAddress);
  }

  /**
   * Get an unsigned withdraw transaction for Drift
   * @param vaultAddress Spot market pubkey (stored as vaultAddress in DB)
   * @param amount Amount in raw token units (e.g. "100000" for 0.1 USDC)
   * @param walletAddress User's wallet address
   */
  async withdraw(vaultAddress: string, amount: string, walletAddress: string): Promise<string> {
    const userPubkey = new PublicKey(walletAddress);
    const spotMarket = this.getSpotMarketByVaultAddress(vaultAddress);
    const tokenProgramId = getTokenProgramForSpotMarket(spotMarket);
    const programId = this.driftClient.program.programId;

    const userAccountPubkey = getUserAccountPublicKeySync(programId, userPubkey, 0);
    const userStatsPubkey = getUserStatsAccountPublicKey(programId, userPubkey);
    const ata = this.getAssociatedTokenAddress(spotMarket.mint, userPubkey, tokenProgramId);
    const bnAmount = new BN(amount);

    // Fetch user's Drift account data for remaining accounts
    const userAccountData = await this.driftClient.program.account.user.fetch(
      userAccountPubkey,
    ) as UserAccount;

    const remainingAccounts = this.driftClient.getRemainingAccounts({
      userAccounts: [userAccountData],
      writableSpotMarketIndexes: [spotMarket.marketIndex],
    });

    // CreateIdempotent ATA instruction (no-op if ATA already exists)
    const createAtaIx = new TransactionInstruction({
      keys: [
        { pubkey: userPubkey, isSigner: true, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: userPubkey, isSigner: false, isWritable: false },
        { pubkey: spotMarket.mint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: tokenProgramId, isSigner: false, isWritable: false },
      ],
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      data: Buffer.from([1]),
    });

    // Build withdraw instruction manually (SDK doesn't support authority override for withdraw)
    const withdrawIx = await this.driftClient.program.methods
      .withdraw(spotMarket.marketIndex, bnAmount, false)
      .accounts({
        state: await this.driftClient.getStatePublicKey(),
        spotMarket: spotMarket.pubkey,
        spotMarketVault: spotMarket.vault,
        driftSigner: getDriftSignerPublicKey(programId),
        user: userAccountPubkey,
        userStats: userStatsPubkey,
        userTokenAccount: ata,
        authority: userPubkey,
        tokenProgram: tokenProgramId,
      })
      .remainingAccounts(remainingAccounts)
      .instruction();

    return this.buildTransaction([createAtaIx, withdrawIx], walletAddress);
  }

  /**
   * Get wallet positions across active Drift spot markets
   * Fetches user's Drift account and returns deposit amounts for active vaults
   */
  async getWalletPositions(walletAddress: string): Promise<{ vaultAddress: string; mint: string; amount: string }[]> {
    try {
      const vaults = await this.db.getActiveVaults(EarnTokenType.DRIFT);
      if (vaults.length === 0) return [];

      const programId = this.driftClient.program.programId;
      const userPubkey = new PublicKey(walletAddress);
      const userAccountPubkey = getUserAccountPublicKeySync(programId, userPubkey, 0);

      let userAccountData: UserAccount;
      try {
        userAccountData = await this.driftClient.program.account.user.fetch(
          userAccountPubkey,
        ) as UserAccount;
      } catch {
        // User has no Drift account
        return [];
      }

      const vaultsByPubkey = new Map(vaults.map((v) => [v.vaultAddress, v]));

      return userAccountData.spotPositions
        .filter((pos) => pos.scaledBalance.gt(new BN(0)) && 'deposit' in pos.balanceType)
        .map((pos) => {
          const spotMarket = this.driftClient.getSpotMarketAccount(pos.marketIndex);
          if (!spotMarket) return null;

          const vault = vaultsByPubkey.get(spotMarket.pubkey.toBase58());
          if (!vault) return null;

          const tokenAmount = getTokenAmount(pos.scaledBalance, spotMarket, pos.balanceType);

          return {
            vaultAddress: vault.vaultAddress!,
            mint: vault.mint,
            amount: tokenAmount.toString(),
          };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null);
    } catch (error) {
      console.error('Error fetching Drift wallet positions:', error);
      return [];
    }
  }

  private getSpotMarketByVaultAddress(vaultAddress: string): SpotMarketAccount {
    const markets = this.driftClient.getSpotMarketAccounts();
    const market = markets.find((m) => m.pubkey.toBase58() === vaultAddress);
    if (!market) throw new Error(`Drift spot market not found: ${vaultAddress}`);
    return market;
  }

  private getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey, tokenProgramId: PublicKey): PublicKey {
    const [ata] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    return ata;
  }

  /**
   * Convert web3.js TransactionInstructions to an unsigned base64 transaction using @solana/kit
   */
  private async buildTransaction(ixs: TransactionInstruction[], feePayer: string): Promise<string> {
    const instructions = ixs.map((ix) => ({
      programAddress: address(ix.programId.toBase58()),
      accounts: ix.keys.map((key) => ({
        address: address(key.pubkey.toBase58()),
        role: key.isSigner
          ? key.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER
          : key.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY,
      })),
      data: new Uint8Array(ix.data),
    }));

    const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();

    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayer(address(feePayer), tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (tx) => instructions.reduce((msg: any, ix) => appendTransactionMessageInstruction(ix, msg), tx),
    );

    const compiled = compileTransaction(transactionMessage);
    return getBase64EncodedWireTransaction(compiled);
  }

  private async saveTokensToDatabase(markets: DriftSpotMarketData[]): Promise<void> {
    const upserts: EarnTokenUpsert[] = markets.map((market) => ({
      type: EarnTokenType.DRIFT,
      mint: market.mint,
      vaultAddress: market.pubkey,
      vaultTitle: `Drift - ${SUPPORTED_TOKENS_BY_MINT[market.mint]?.symbol ?? ''}`,
      symbol: SUPPORTED_TOKENS_BY_MINT[market.mint]?.symbol ?? '',
      rewardsRate: market.depositRate * 10000,
      protocolData: market.rawAccount,
    }));

    await this.db.upsertEarnTokens(upserts);
  }
}

export default DriftManager;
