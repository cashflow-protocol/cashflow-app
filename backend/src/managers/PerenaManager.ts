import axios, { AxiosInstance } from 'axios';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  addLiquidity,
  getPoolKeys,
  init,
  removeLiquidity,
  state,
  PRODUCTION_POOLS,
} from '@perena/numeraire-sdk';
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
import { EarnTokenType } from '../types';
import type { SerializedInstruction } from '../types';
import { DBManager, EarnTokenUpsert } from './DBManager';

const PERENA_ICON_URL = 'https://cashflowfi.ams3.cdn.digitaloceanspaces.com/logos/perena.jpg';
const USD_STAR_MINT = 'star9agSpjiFe3M49B3RniVU4CMBBEK3Qnaqn3RGiFM';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// Seed pool (USDC/USDT/PYUSD with weights 45/35/20). USDC is index 0.
const SEED_POOL_ADDRESS = PRODUCTION_POOLS.tripool || '2w4A1eGyjRutakyFdmVyBiLPf98qKxNTC2LpuwhaCruZ';
const USDC_INDEX_IN_POOL = 0;
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SLIPPAGE_BPS = 50; // 0.5%

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
  private connection: Connection;
  private rpc: Rpc<SolanaRpcApi>;
  private db: DBManager;
  /** Serializes SDK calls — the SDK reads a global `state.wallet` for ATA derivation
   *  so concurrent requests with different users would race. */
  private sdkLock: Promise<unknown> = Promise.resolve();
  /** Cached USD* / USDC price from the Perena API (refreshed on demand) */
  private cachedPrice: number = 1.0;
  private cachedPriceAt: number = 0;

  constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, { commitment: 'confirmed' });
    this.rpc = createSolanaRpc(rpcUrl);
    this.db = new DBManager();
    this.api = axios.create({
      baseURL: 'https://api.perena.org',
      timeout: 30_000,
    });

    // SDK init: pass a placeholder keypair (we override state.wallet per call).
    // applyD=false makes the SDK take raw token amounts instead of UI amounts.
    init({
      payer: Keypair.generate(),
      connection: this.connection,
      applyD: false,
    });
  }

  /**
   * Fetch current APY and mint info from Perena, then upsert into the database.
   * Schema: mint=USDC (deposit asset), vaultAddress=SEED_POOL (Numeraire pool address).
   * USD* is the LP / position token, tracked in protocolData.
   */
  async getEarnTokens(): Promise<void> {
    const [apyRes, mintInfoRes] = await Promise.all([
      this.api.get<PerenaApyResponse>('/api/usdstar/apy', { params: { period: '7d' } }),
      this.api.get<PerenaMintInfoResponse>('/api/usdstar/mint-info'),
    ]);

    const { apy } = apyRes.data;
    const mintInfo = mintInfoRes.data;

    // Cache the price so withdrawals can convert USDC → LP amount without a fresh fetch
    if (mintInfo.price > 0) {
      this.cachedPrice = mintInfo.price;
      this.cachedPriceAt = Date.now();
    }

    // rewardsRate convention: mobile displays (rewardsRate / 100).toFixed(2) + '%'
    // Perena returns apy as a percentage (e.g. 5.0 for 5%), so rewardsRate = apy * 100
    const rewardsRate = Math.round(apy * 100);

    const token: EarnTokenUpsert = {
      type: EarnTokenType.PERENA,
      mint: USDC_MINT,
      vaultAddress: SEED_POOL_ADDRESS,
      vaultTitle: 'Perena - USD*',
      symbol: 'USDC',
      rewardsRate,
      minDepositAmount: '0',
      minWithdrawAmount: '0',
      minAppBuild: 50,
      protocolName: 'Perena',
      protocolIconUrl: PERENA_ICON_URL,
      protocolData: {
        apy: apyRes.data,
        mintInfo,
        lpMint: USD_STAR_MINT,
        poolAddress: SEED_POOL_ADDRESS,
        depositMint: USDC_MINT,
      },
    };

    await this.db.upsertEarnTokens([token]);
  }

  /**
   * Fetch user's Perena position: their USD* balance, returned as the USDC-equivalent
   * value so the route's per-mint aggregation works uniformly across protocols.
   */
  async getWalletPositions(
    walletAddress: string,
  ): Promise<{ vaultAddress: string; mint: string; amount: string }[]> {
    try {
      const owner = new PublicKey(walletAddress);
      const usdStarAta = this.getAta(new PublicKey(USD_STAR_MINT), owner);

      let usdStarRaw: bigint;
      try {
        const bal = await this.connection.getTokenAccountBalance(usdStarAta, 'confirmed');
        usdStarRaw = BigInt(bal.value.amount);
      } catch {
        // ATA doesn't exist or is empty — no position
        return [];
      }
      if (usdStarRaw === 0n) return [];

      const price = await this.getUsdStarPrice();
      // USDC equivalent = USD* balance * USD*/USDC price. Both 6 decimals so no scaling needed.
      const usdcEquivRaw = (usdStarRaw * BigInt(Math.round(price * 1e9))) / BigInt(1e9);

      return [
        {
          vaultAddress: SEED_POOL_ADDRESS,
          mint: USDC_MINT,
          amount: usdcEquivRaw.toString(),
        },
      ];
    } catch (error) {
      console.error('Error fetching Perena wallet positions:', error);
      return [];
    }
  }

  /**
   * Get raw deposit instructions for Perena (used by Squads vault flow).
   * @param _vaultAddress Ignored — Perena has a single pool. Kept for signature parity.
   * @param amount Raw USDC amount (6 decimals)
   * @param ownerAddress User's wallet/vault address (the depositor)
   */
  async getDepositInstructions(
    _vaultAddress: string,
    amount: string,
    ownerAddress: string,
  ): Promise<SerializedInstruction[]> {
    const ixs = await this.buildDepositInstructions(amount, ownerAddress);
    return ixs.map((ix) => this.web3IxToSerialized(ix));
  }

  /**
   * Get raw withdraw instructions for Perena (used by Squads vault flow).
   * @param amount Raw USDC amount the user wants to receive
   * @param ownerAddress User's wallet/vault address (the redeemer)
   */
  async getWithdrawInstructions(
    _vaultAddress: string,
    amount: string,
    ownerAddress: string,
  ): Promise<SerializedInstruction[]> {
    const ixs = await this.buildWithdrawInstructions(amount, ownerAddress);
    return ixs.map((ix) => this.web3IxToSerialized(ix));
  }

  /** Get an unsigned base64 deposit transaction (legacy flow). */
  async deposit(_vaultAddress: string, amount: string, walletAddress: string): Promise<string> {
    const ixs = await this.buildDepositInstructions(amount, walletAddress);
    return this.buildTransaction(ixs, walletAddress);
  }

  /** Get an unsigned base64 withdraw transaction (legacy flow). */
  async withdraw(_vaultAddress: string, amount: string, walletAddress: string): Promise<string> {
    const ixs = await this.buildWithdrawInstructions(amount, walletAddress);
    return this.buildTransaction(ixs, walletAddress);
  }

  // ---------------- private helpers ----------------

  private async buildDepositInstructions(
    amount: string,
    ownerAddress: string,
  ): Promise<TransactionInstruction[]> {
    const owner = new PublicKey(ownerAddress);
    const usdcAmount = Number(amount);
    if (!Number.isFinite(usdcAmount) || usdcAmount <= 0) {
      throw new Error(`Invalid deposit amount: ${amount}`);
    }

    // Slippage-protect: minimum USD* expected ≈ usdcAmount / price * (1 - slippage)
    const price = await this.getUsdStarPrice();
    const expectedLp = usdcAmount / Math.max(price, 1e-9);
    const minLpTokenMintAmount = Math.floor(expectedLp * (10000 - SLIPPAGE_BPS) / 10000);

    const ix = await this.withSdkLock(owner, async () => {
      const { call } = await addLiquidity({
        pool: new PublicKey(SEED_POOL_ADDRESS),
        maxAmountsIn: [usdcAmount, 0, 0], // USDC only; USDT and PYUSD skipped
        minLpTokenMintAmount,
        takeSwaps: true,
      });
      return (await call.instruction()) as TransactionInstruction;
    });

    // Prepend idempotent ATA creates so the deposit doesn't fail if either is missing
    const usdcAta = this.getAta(new PublicKey(USDC_MINT), owner);
    const usdStarAta = this.getAta(new PublicKey(USD_STAR_MINT), owner);
    return [
      this.createIdempotentAtaIx(usdcAta, new PublicKey(USDC_MINT), owner),
      this.createIdempotentAtaIx(usdStarAta, new PublicKey(USD_STAR_MINT), owner),
      ix,
    ];
  }

  private async buildWithdrawInstructions(
    amount: string,
    ownerAddress: string,
  ): Promise<TransactionInstruction[]> {
    const owner = new PublicKey(ownerAddress);
    const usdcAmount = Number(amount);
    if (!Number.isFinite(usdcAmount) || usdcAmount <= 0) {
      throw new Error(`Invalid withdraw amount: ${amount}`);
    }

    // Convert target USDC out → required USD* (LP) input. Round up so user gets
    // at least the requested amount; the pool returns slightly more if price > 1.
    const price = await this.getUsdStarPrice();
    const lpTokenRedeemAmount = Math.ceil(usdcAmount / Math.max(price, 1e-9));

    // Slippage floor: minimum USDC out
    const minUsdcOut = Math.floor(usdcAmount * (10000 - SLIPPAGE_BPS) / 10000);
    const minAmountsOut = [minUsdcOut, 0, 0];

    const ix = await this.withSdkLock(owner, async () => {
      const { call } = await removeLiquidity({
        pool: new PublicKey(SEED_POOL_ADDRESS),
        lpTokenRedeemAmount,
        out: USDC_INDEX_IN_POOL,
        minAmountsOut,
      });
      return (await call.instruction()) as TransactionInstruction;
    });

    const usdcAta = this.getAta(new PublicKey(USDC_MINT), owner);
    return [
      this.createIdempotentAtaIx(usdcAta, new PublicKey(USDC_MINT), owner),
      ix,
    ];
  }

  /**
   * The SDK reads `state.wallet.publicKey` (a module-level singleton) when deriving
   * per-user ATAs inside getLiqAccounts. Override it for the duration of the call,
   * and serialize all calls so concurrent requests don't see each other's user.
   */
  private async withSdkLock<T>(owner: PublicKey, fn: () => Promise<T>): Promise<T> {
    const prev = this.sdkLock;
    let release!: () => void;
    const next = new Promise<void>((r) => { release = r; });
    this.sdkLock = next;
    try {
      await prev.catch(() => {});
      const originalWallet = (state as any).wallet;
      const userWallet = {
        publicKey: owner,
        payer: Keypair.generate(),
        signTransaction: async (tx: any) => tx,
        signAllTransactions: async (txs: any) => txs,
      };
      (state as any).wallet = userWallet;
      try {
        return await fn();
      } finally {
        (state as any).wallet = originalWallet;
      }
    } finally {
      release();
    }
  }

  private async getUsdStarPrice(): Promise<number> {
    // Use the cron-refreshed cache when it's < 5 minutes old; otherwise fetch fresh.
    const ageMs = Date.now() - this.cachedPriceAt;
    if (this.cachedPriceAt > 0 && ageMs < 5 * 60 * 1000) {
      return this.cachedPrice;
    }
    try {
      const res = await this.api.get<PerenaMintInfoResponse>('/api/usdstar/mint-info');
      if (res.data.price > 0) {
        this.cachedPrice = res.data.price;
        this.cachedPriceAt = Date.now();
        return this.cachedPrice;
      }
    } catch (e) {
      console.warn('[Perena] Failed to refresh price, using cached:', (e as Error).message);
    }
    return this.cachedPrice;
  }

  private getAta(mint: PublicKey, owner: PublicKey): PublicKey {
    const [ata] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    return ata;
  }

  private createIdempotentAtaIx(
    ata: PublicKey,
    mint: PublicKey,
    owner: PublicKey,
  ): TransactionInstruction {
    return new TransactionInstruction({
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      data: Buffer.from([1]), // CreateIdempotent
    });
  }

  private web3IxToSerialized(ix: TransactionInstruction): SerializedInstruction {
    return {
      programId: ix.programId.toBase58(),
      accounts: ix.keys.map((key) => ({
        pubkey: key.pubkey.toBase58(),
        isSigner: key.isSigner,
        isWritable: key.isWritable,
      })),
      data: Buffer.from(ix.data).toString('base64'),
    };
  }

  /** Build a base64-encoded unsigned versioned transaction from web3.js instructions */
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

  /** Get the cached pool keys (used by tests or future callers). */
  async getPoolInfo() {
    return getPoolKeys(new PublicKey(SEED_POOL_ADDRESS));
  }
}

export default PerenaManager;
