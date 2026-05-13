import axios, { AxiosInstance } from 'axios';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import {
  InsuredUsdStarClient,
  UsdStarClient,
  BankinecoUserClient,
} from '@perena/bankineco-sdk';
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
  AccountRole,
} from '@solana/kit';
import type { Rpc, SolanaRpcApi } from '@solana/kit';
import { EarnTokenType } from '../types';
import type { SerializedInstruction } from '../types';
import { DBManager, EarnTokenUpsert } from './DBManager';
import {
  USDC_MINT,
  ASSOCIATED_TOKEN_PROGRAM_ID as ASSOCIATED_TOKEN_PROGRAM_ID_STRING,
  TOKEN_PROGRAM_ID as TOKEN_PROGRAM_ID_STRING,
  TOKEN_2022_PROGRAM_ID as TOKEN_2022_PROGRAM_ID_STRING,
} from '../constants';

const PERENA_ICON_URL = 'https://cashflowfi.ams3.cdn.digitaloceanspaces.com/logos/perena.jpg';
/** USD* bank mint (the regular yield-bearing position token). */
const USD_STAR_MINT = 'star9agSpjiFe3M49B3RniVU4CMBBEK3Qnaqn3RGiFM';
/** USD*-P bank mint (the Insured/Protected position token). */
const USD_P_MINT = 'CPFZ7wUFpg5obsGB2GKXQ8rPY5ALuxs87dEjQjsrVxWw';
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID_STRING);
const TOKEN_PROGRAM_ID = new PublicKey(TOKEN_PROGRAM_ID_STRING);
const TOKEN_2022_PROGRAM_ID = new PublicKey(TOKEN_2022_PROGRAM_ID_STRING);
/** USD*-P fixed APY per Perena docs. Display = rewardsRate / 100 → "5.00%". */
const USD_P_REWARDS_RATE = 500;

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
  /** Cached USD* / USDC price from the Perena API (refreshed on demand) */
  private cachedPrice: number = 1.0;
  private cachedPriceAt: number = 0;
  /** Cached USD*-P / USDC price (refreshed on demand) */
  private cachedProtectedPrice: number = 1.0;
  private cachedProtectedPriceAt: number = 0;
  /** Cache of mint → owning token program (classic vs Token-2022). Mints never change owner. */
  private mintProgramCache: Map<string, PublicKey> = new Map();
  /** Lazy-initialized USD* client (heavyweight — bankineco-sdk pulls Kamino/MarginFi/Jupiter SDKs). */
  private _usdStarClient: UsdStarClient | null = null;
  private _insuredClient: InsuredUsdStarClient | null = null;

  constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, { commitment: 'confirmed' });
    this.rpc = createSolanaRpc(rpcUrl);
    this.db = new DBManager();
    this.api = axios.create({
      baseURL: 'https://api.perena.org',
      timeout: 30_000,
    });
  }

  /** Construct a placeholder Anchor-style wallet (we pass the real user per-call). */
  private placeholderWallet() {
    const kp = Keypair.generate();
    return {
      publicKey: kp.publicKey,
      payer: kp,
      signTransaction: async (tx: any) => tx,
      signAllTransactions: async (txs: any) => txs,
    };
  }

  private get usdStarClient(): UsdStarClient {
    if (!this._usdStarClient) {
      const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
      this._usdStarClient = UsdStarClient.new({
        env: 'prod',
        rpcUrl,
        wallet: this.placeholderWallet(),
      } as any);
    }
    return this._usdStarClient;
  }

  private get insuredClient(): InsuredUsdStarClient {
    if (!this._insuredClient) {
      const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
      this._insuredClient = InsuredUsdStarClient.new({
        env: 'prod',
        rpcUrl,
        wallet: this.placeholderWallet(),
      } as any);
    }
    return this._insuredClient;
  }

  /**
   * Fetch APY/price for both Perena products and upsert them as two EarnToken records.
   * Both products use the bankineco program for mint/burn (no AMM swaps).
   * - USD*:   mint=USDC, vaultAddress=USD_STAR_MINT (bank mint)
   * - USD*-P: mint=USDC, vaultAddress=USD_P_MINT (insured bank mint)
   */
  async getEarnTokens(): Promise<void> {
    const [apyRes, mintInfoRes] = await Promise.all([
      this.api.get<PerenaApyResponse>('/api/usdstar/apy', { params: { period: '7d' } }),
      this.api.get<PerenaMintInfoResponse>('/api/usdstar/mint-info'),
    ]);

    const { apy } = apyRes.data;
    const mintInfo = mintInfoRes.data;
    if (mintInfo.price > 0) {
      this.cachedPrice = mintInfo.price;
      this.cachedPriceAt = Date.now();
    }
    const usdStarRewardsRate = Math.round(apy * 100);

    // Refresh the protected price too (don't fail the whole cron if it errors)
    let protectedPrice = this.cachedProtectedPrice;
    try {
      protectedPrice = await this.insuredClient.latestBankMintUiPrice();
      if (protectedPrice > 0) {
        this.cachedProtectedPrice = protectedPrice;
        this.cachedProtectedPriceAt = Date.now();
      }
    } catch (e) {
      console.warn('[Perena] latestBankMintUiPrice failed:', (e as Error).message);
    }

    const usdStarToken: EarnTokenUpsert = {
      type: EarnTokenType.PERENA,
      mint: USDC_MINT,
      vaultAddress: USD_STAR_MINT,
      vaultTitle: 'Perena - USD*',
      symbol: 'USDC',
      rewardsRate: usdStarRewardsRate,
      minDepositAmount: '0',
      minWithdrawAmount: '0',
      minAppBuild: 50,
      protocolName: 'Perena',
      protocolIconUrl: PERENA_ICON_URL,
      protocolData: {
        apy: apyRes.data,
        mintInfo,
        bankMint: USD_STAR_MINT,
        depositMint: USDC_MINT,
        product: 'usd-star',
      },
    };

    const protectedToken: EarnTokenUpsert = {
      type: EarnTokenType.PERENA,
      mint: USDC_MINT,
      vaultAddress: USD_P_MINT,
      vaultTitle: 'Perena - USD* Protected',
      symbol: 'USDC',
      rewardsRate: USD_P_REWARDS_RATE,
      minDepositAmount: '0',
      minWithdrawAmount: '0',
      minAppBuild: 50,
      protocolName: 'Perena',
      protocolIconUrl: PERENA_ICON_URL,
      protocolData: {
        bankMint: USD_P_MINT,
        price: protectedPrice,
        product: 'usd-star-protected',
      },
    };

    await this.db.upsertEarnTokens([usdStarToken, protectedToken]);
  }

  /**
   * Fetch user's positions in both Perena products. Both products track positions via
   * a distinct on-chain bank mint (USD* vs USD*-P) — read each ATA balance and convert
   * to USDC-equivalent so the per-mint aggregation in routes/earn.ts works uniformly.
   */
  async getWalletPositions(
    walletAddress: string,
  ): Promise<{ vaultAddress: string; mint: string; amount: string }[]> {
    const owner = new PublicKey(walletAddress);
    const positions: { vaultAddress: string; mint: string; amount: string }[] = [];

    // USD* (regular yield)
    try {
      const usdStarMint = new PublicKey(USD_STAR_MINT);
      const program = await this.getMintProgram(usdStarMint);
      const ata = this.getAta(usdStarMint, owner, program);
      const raw = await this.tryGetTokenBalance(ata);
      if (raw > 0n) {
        const price = await this.getUsdStarPrice();
        const usdcEquiv = (raw * BigInt(Math.round(price * 1e9))) / BigInt(1e9);
        positions.push({ vaultAddress: USD_STAR_MINT, mint: USDC_MINT, amount: usdcEquiv.toString() });
      }
    } catch (error) {
      console.error('Error fetching Perena USD* position:', (error as Error).message);
    }

    // USD*-P (protected)
    try {
      const usdPMint = new PublicKey(USD_P_MINT);
      const program = await this.getMintProgram(usdPMint);
      const ata = this.getAta(usdPMint, owner, program);
      const raw = await this.tryGetTokenBalance(ata);
      if (raw > 0n) {
        const price = await this.getProtectedPrice();
        const usdcEquiv = (raw * BigInt(Math.round(price * 1e9))) / BigInt(1e9);
        positions.push({ vaultAddress: USD_P_MINT, mint: USDC_MINT, amount: usdcEquiv.toString() });
      }
    } catch (error) {
      console.error('Error fetching Perena USD*-P position:', (error as Error).message);
    }

    return positions;
  }

  /** Squads vault flow — return raw deposit instructions + extra LUTs (if any). */
  async getDepositInstructions(
    vaultAddress: string,
    amount: string,
    ownerAddress: string,
  ): Promise<{ instructions: SerializedInstruction[]; lookupTables: string[] }> {
    const { ixs, lookupTables } = await this.buildDepositArtifacts(vaultAddress, amount, ownerAddress);
    return {
      instructions: ixs.map((ix) => this.web3IxToSerialized(ix)),
      lookupTables: lookupTables.map((p) => p.toBase58()),
    };
  }

  /** Squads vault flow — return raw withdraw instructions + extra LUTs (if any). */
  async getWithdrawInstructions(
    vaultAddress: string,
    amount: string,
    ownerAddress: string,
  ): Promise<{ instructions: SerializedInstruction[]; lookupTables: string[] }> {
    const { ixs, lookupTables } = await this.buildWithdrawArtifacts(vaultAddress, amount, ownerAddress);
    return {
      instructions: ixs.map((ix) => this.web3IxToSerialized(ix)),
      lookupTables: lookupTables.map((p) => p.toBase58()),
    };
  }

  /** Legacy flow — return base64-encoded unsigned deposit transaction. */
  async deposit(vaultAddress: string, amount: string, walletAddress: string): Promise<string> {
    const { ixs, lookupTables } = await this.buildDepositArtifacts(vaultAddress, amount, walletAddress);
    return this.buildTransaction(ixs, walletAddress, lookupTables);
  }

  /** Legacy flow — return base64-encoded unsigned withdraw transaction. */
  async withdraw(vaultAddress: string, amount: string, walletAddress: string): Promise<string> {
    const { ixs, lookupTables } = await this.buildWithdrawArtifacts(vaultAddress, amount, walletAddress);
    return this.buildTransaction(ixs, walletAddress, lookupTables);
  }

  // ---------------- dispatch ----------------

  private clientForVault(vaultAddress: string): BankinecoUserClient {
    if (vaultAddress === USD_STAR_MINT) return this.usdStarClient;
    if (vaultAddress === USD_P_MINT) return this.insuredClient;
    throw new Error(`Unknown Perena vault: ${vaultAddress}`);
  }

  private async priceForVault(vaultAddress: string): Promise<number> {
    if (vaultAddress === USD_STAR_MINT) return this.getUsdStarPrice();
    if (vaultAddress === USD_P_MINT) return this.getProtectedPrice();
    throw new Error(`Unknown Perena vault: ${vaultAddress}`);
  }

  /**
   * Deposit: USDC → bank mint (USD* or USD*-P).
   * `amount` is raw USDC (6 decimals).
   */
  private async buildDepositArtifacts(
    vaultAddress: string,
    amount: string,
    ownerAddress: string,
  ): Promise<{ ixs: TransactionInstruction[]; lookupTables: PublicKey[] }> {
    const client = this.clientForVault(vaultAddress);
    const owner = new PublicKey(ownerAddress);

    const { transaction, lookupTables } = await client.mintFromYieldingTx({
      yieldingAmount: new BN(amount),
      fromYieldingMint: new PublicKey(USDC_MINT),
      user: owner,
    });

    return { ixs: transaction.instructions, lookupTables };
  }

  /**
   * Withdraw: bank mint (USD* or USD*-P) → USDC.
   * `amount` is the raw USDC the user wants out; we convert to the equivalent bank-mint
   * amount using the latest price and pass that to burnForYieldingTx.
   */
  private async buildWithdrawArtifacts(
    vaultAddress: string,
    amount: string,
    ownerAddress: string,
  ): Promise<{ ixs: TransactionInstruction[]; lookupTables: PublicKey[] }> {
    const client = this.clientForVault(vaultAddress);
    const owner = new PublicKey(ownerAddress);

    const usdcOut = Number(amount);
    if (!Number.isFinite(usdcOut) || usdcOut <= 0) {
      throw new Error(`Invalid withdraw amount: ${amount}`);
    }
    const price = await this.priceForVault(vaultAddress);
    // Round up so the user receives ≥ the requested USDC after burn.
    const bankMintAmount = new BN(Math.ceil(usdcOut / Math.max(price, 1e-9)).toString());

    const { transaction, lookupTables } = await client.burnForYieldingTx({
      bankMintAmount,
      toYieldingMint: new PublicKey(USDC_MINT),
      user: owner,
    });

    return { ixs: transaction.instructions, lookupTables };
  }

  // ---------------- helpers ----------------

  private async tryGetTokenBalance(ata: PublicKey): Promise<bigint> {
    try {
      const bal = await this.connection.getTokenAccountBalance(ata, 'confirmed');
      return BigInt(bal.value.amount);
    } catch {
      return 0n;
    }
  }

  private async getUsdStarPrice(): Promise<number> {
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
      console.warn('[Perena] Failed to refresh USD* price, using cached:', (e as Error).message);
    }
    return this.cachedPrice;
  }

  private async getProtectedPrice(): Promise<number> {
    const ageMs = Date.now() - this.cachedProtectedPriceAt;
    if (this.cachedProtectedPriceAt > 0 && ageMs < 5 * 60 * 1000) {
      return this.cachedProtectedPrice;
    }
    try {
      const price = await this.insuredClient.latestBankMintUiPrice();
      if (price > 0) {
        this.cachedProtectedPrice = price;
        this.cachedProtectedPriceAt = Date.now();
        return this.cachedProtectedPrice;
      }
    } catch (e) {
      console.warn('[Perena] Failed to refresh USD*-P price, using cached:', (e as Error).message);
    }
    return this.cachedProtectedPrice;
  }

  /** Look up which token program owns a mint (classic SPL Token vs Token-2022). Cached. */
  private async getMintProgram(mint: PublicKey): Promise<PublicKey> {
    const key = mint.toBase58();
    const cached = this.mintProgramCache.get(key);
    if (cached) return cached;
    const info = await this.connection.getAccountInfo(mint, 'confirmed');
    if (!info) throw new Error(`Mint account not found: ${key}`);
    if (!info.owner.equals(TOKEN_PROGRAM_ID) && !info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      throw new Error(`Mint ${key} is owned by unexpected program ${info.owner.toBase58()}`);
    }
    this.mintProgramCache.set(key, info.owner);
    return info.owner;
  }

  private getAta(mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey): PublicKey {
    const [ata] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    return ata;
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

  /**
   * Build a base64-encoded unsigned VersionedTransaction from web3.js instructions,
   * optionally compressing the message with the provided lookup-table pubkeys.
   */
  private async buildTransaction(
    ixs: TransactionInstruction[],
    feePayer: string,
    lookupTables: PublicKey[] = [],
  ): Promise<string> {
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

    const baseMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayer(address(feePayer), tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (tx) => instructions.reduce((msg: any, ix) => appendTransactionMessageInstruction(ix, msg), tx),
    );

    let transactionMessage = baseMessage;
    if (lookupTables.length > 0) {
      try {
        const lutAddrs = lookupTables.map((lut) => address(lut.toBase58()));
        const addressesByLut = await fetchAddressesForLookupTables(lutAddrs, this.rpc);
        if (Object.keys(addressesByLut).length > 0) {
          transactionMessage = compressTransactionMessageUsingAddressLookupTables(
            baseMessage,
            addressesByLut,
          ) as typeof baseMessage;
        }
      } catch (err) {
        console.warn('[Perena] Failed to compress with LUTs, sending uncompressed:', (err as Error).message);
      }
    }

    const compiled = compileTransaction(transactionMessage);
    return getBase64EncodedWireTransaction(compiled);
  }
}

export default PerenaManager;
