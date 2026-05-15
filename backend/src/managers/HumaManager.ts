import {
  Connection,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import {
  PermissionlessClient,
  SolanaChainEnum,
  DepositMode,
  DepositCommitment,
  getMetadata,
  getPrimeMetadata,
  VaultOption,
} from '@huma-finance/permissionless-sdk';
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

const HUMA_ICON_URL = 'https://cashflowfi.ams3.cdn.digitaloceanspaces.com/logos/huma.png';
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID_STRING);
const TOKEN_PROGRAM_ID = new PublicKey(TOKEN_PROGRAM_ID_STRING);
const TOKEN_2022_PROGRAM_ID = new PublicKey(TOKEN_2022_PROGRAM_ID_STRING);

const POOL = getMetadata(SolanaChainEnum.MAINNET);
const PRIME_VAULT_META = getPrimeMetadata(SolanaChainEnum.MAINNET)[VaultOption.PST];

const CLASSIC_VAULT_ADDRESS = POOL.classicModeConfig;
const PRIME_VAULT_ADDRESS = PRIME_VAULT_META.vaultConfig;
const PST_MINT = POOL.classicModeMint;

const PRIME_FALLBACK_REWARDS_RATE = 1360;

export class HumaManager {
  private connection: Connection;
  private rpc: Rpc<SolanaRpcApi>;
  private db: DBManager;
  private client: PermissionlessClient;

  private cachedClassicPrice: number = 1.0;
  private cachedClassicPriceAt: number = 0;
  private mintProgramCache: Map<string, PublicKey> = new Map();

  constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, { commitment: 'confirmed' });
    this.rpc = createSolanaRpc(rpcUrl);
    this.db = new DBManager();
    this.client = new PermissionlessClient(rpcUrl, SolanaChainEnum.MAINNET);
  }

  /**
   * Cron entry: refresh Classic APY via SDK, upsert two records:
   *   - Classic (No Lockup) — vaultAddress = classicModeConfig, full integration
   *   - Prime — vaultAddress = vault PDA, listing-only (no deposit/withdraw wired)
   */
  async getEarnTokens(): Promise<void> {
    let classicTotalApy = 0;
    let classicApyInfo: { baseApy: number; estRewardsApy: number; totalApy: number } | null = null;
    try {
      classicApyInfo = await this.client.getModeApyInfo(DepositMode.CLASSIC);
      classicTotalApy = classicApyInfo.totalApy;
    } catch (e) {
      console.warn('[Huma] getModeApyInfo(CLASSIC) failed, using fallback:', (e as Error).message);
    }
    // SDK returns APY in basis points (e.g. 1050 = 10.50%). Our rewardsRate convention is
    // also bp×10 — display = rewardsRate / 100 → "10.50%" — so map 1:1.
    const classicRewardsRate = classicTotalApy > 0 ? Math.round(classicTotalApy) : 1050;

    try {
      const priceBn = await this.client.getModeTokenPrice(DepositMode.CLASSIC);
      const price = Number(priceBn.toString()) / 1e6;
      if (price > 0) {
        this.cachedClassicPrice = price;
        this.cachedClassicPriceAt = Date.now();
      }
    } catch (e) {
      console.warn('[Huma] getModeTokenPrice(CLASSIC) failed, using cached price:', (e as Error).message);
    }

    const classicToken: EarnTokenUpsert = {
      type: EarnTokenType.HUMA,
      mint: USDC_MINT,
      vaultAddress: CLASSIC_VAULT_ADDRESS,
      vaultTitle: 'Huma - Classic',
      symbol: 'USDC',
      rewardsRate: classicRewardsRate,
      minDepositAmount: '1000000',
      minWithdrawAmount: '0',
      minAppBuild: 50,
      categories: ['yield-stable'],
      protocolName: 'Huma',
      protocolIconUrl: HUMA_ICON_URL,
      protocolData: {
        apy: classicApyInfo,
        modeMint: PST_MINT,
        modeConfig: CLASSIC_VAULT_ADDRESS,
        depositMint: USDC_MINT,
        product: 'classic-no-lockup',
        commitment: 'NO_COMMITMENT',
      },
    };

    const primeToken: EarnTokenUpsert = {
      type: EarnTokenType.HUMA,
      mint: USDC_MINT,
      vaultAddress: PRIME_VAULT_ADDRESS,
      vaultTitle: 'Huma - Prime',
      symbol: 'USDC',
      rewardsRate: PRIME_FALLBACK_REWARDS_RATE,
      minDepositAmount: '10000000',
      minWithdrawAmount: '0',
      minAppBuild: 50,
      categories: ['yield-stable'],
      protocolName: 'Huma',
      protocolIconUrl: HUMA_ICON_URL,
      protocolData: {
        vaultConfig: PRIME_VAULT_ADDRESS,
        primeProgram: PRIME_VAULT_META.primeProgram,
        depositMint: USDC_MINT,
        strategyMint: PRIME_VAULT_META.strategyMint.address,
        product: 'prime-no-lockup',
        note: 'Prime is a leveraged strategy on PST; deposit/withdraw via app.huma.finance',
      },
    };

    await this.db.upsertEarnTokens([classicToken, primeToken]);
  }

  /**
   * Read user's Classic position by inspecting their PST ATA directly. The SDK's
   * `getBalances` couples this with a call to Huma's points API to split locked vs
   * unlocked — which throws (or returns 0) if the API is unreachable, hiding real
   * positions. For the position-display use case we only need the total PST balance,
   * converted to USDC via the share price. (Prime issues a separate LP token, not PST,
   * so it stays listing-only here.)
   */
  async getWalletPositions(
    walletAddress: string,
  ): Promise<{ vaultAddress: string; mint: string; amount: string }[]> {
    const owner = new PublicKey(walletAddress);
    const positions: { vaultAddress: string; mint: string; amount: string }[] = [];

    try {
      const pstMint = new PublicKey(PST_MINT);
      const program = await this.getMintProgram(pstMint);
      const ata = this.getAta(pstMint, owner, program);
      const pstRaw = await this.tryGetTokenBalance(ata);
      if (pstRaw > 0n) {
        const price = await this.getClassicPrice();
        const usdcEquiv = (pstRaw * BigInt(Math.round(price * 1e9))) / BigInt(1e9);
        positions.push({ vaultAddress: CLASSIC_VAULT_ADDRESS, mint: USDC_MINT, amount: usdcEquiv.toString() });
      }
    } catch (error) {
      console.error('[Huma] Failed to read Classic PST balance:', (error as Error).message);
    }

    return positions;
  }

  /** Squads vault flow — Classic deposit instructions. Prime not supported (listing-only). */
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

  /** Squads vault flow — Classic withdraw instructions. */
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

  /** Legacy flow — base64-encoded unsigned deposit transaction. */
  async deposit(vaultAddress: string, amount: string, walletAddress: string): Promise<string> {
    const { ixs, lookupTables } = await this.buildDepositArtifacts(vaultAddress, amount, walletAddress);
    return this.buildTransaction(ixs, walletAddress, lookupTables);
  }

  async withdraw(vaultAddress: string, amount: string, walletAddress: string): Promise<string> {
    const { ixs, lookupTables } = await this.buildWithdrawArtifacts(vaultAddress, amount, walletAddress);
    return this.buildTransaction(ixs, walletAddress, lookupTables);
  }

  private async buildDepositArtifacts(
    vaultAddress: string,
    amount: string,
    ownerAddress: string,
  ): Promise<{ ixs: TransactionInstruction[]; lookupTables: PublicKey[] }> {
    if (vaultAddress !== CLASSIC_VAULT_ADDRESS) {
      throw new Error(
        `Huma deposits are only supported for Classic. Use app.huma.finance for Prime.`,
      );
    }
    const owner = new PublicKey(ownerAddress);
    const tx = await this.client.buildDepositTx(
      owner,
      new BN(amount),
      DepositMode.CLASSIC,
      DepositCommitment.NO_COMMIT,
    );
    if (!tx) {
      throw new Error('Huma deposit failed: SDK returned null (likely max-deposit cap exceeded)');
    }
    const lookupTables = POOL.lookupTable ? [new PublicKey(POOL.lookupTable)] : [];
    return { ixs: tx.instructions, lookupTables };
  }

  private async buildWithdrawArtifacts(
    vaultAddress: string,
    amount: string,
    ownerAddress: string,
  ): Promise<{ ixs: TransactionInstruction[]; lookupTables: PublicKey[] }> {
    if (vaultAddress !== CLASSIC_VAULT_ADDRESS) {
      throw new Error(
        `Huma withdrawals are only supported for Classic. Use app.huma.finance for Prime.`,
      );
    }
    const owner = new PublicKey(ownerAddress);
    // Withdraw amount is interpreted by Huma SDK as the PST share amount, not USDC.
    // We convert from raw USDC (input) to PST raw using the latest share price.
    const usdcOut = Number(amount);
    if (!Number.isFinite(usdcOut) || usdcOut <= 0) {
      throw new Error(`Invalid withdraw amount: ${amount}`);
    }
    const price = await this.getClassicPrice();
    const pstAmount = new BN(Math.ceil(usdcOut / Math.max(price, 1e-9)).toString());
    const tx = await this.client.buildWithdrawTx(owner, pstAmount, DepositMode.CLASSIC);
    const lookupTables = POOL.lookupTable ? [new PublicKey(POOL.lookupTable)] : [];
    return { ixs: tx.instructions, lookupTables };
  }

  private async getClassicPrice(): Promise<number> {
    const ageMs = Date.now() - this.cachedClassicPriceAt;
    if (this.cachedClassicPriceAt > 0 && ageMs < 5 * 60 * 1000) {
      return this.cachedClassicPrice;
    }
    try {
      const priceBn = await this.client.getModeTokenPrice(DepositMode.CLASSIC);
      const price = Number(priceBn.toString()) / 1e6;
      if (price > 0) {
        this.cachedClassicPrice = price;
        this.cachedClassicPriceAt = Date.now();
      }
    } catch (e) {
      console.warn('[Huma] Failed to refresh Classic price, using cached:', (e as Error).message);
    }
    return this.cachedClassicPrice;
  }

  private async tryGetTokenBalance(ata: PublicKey): Promise<bigint> {
    try {
      const bal = await this.connection.getTokenAccountBalance(ata, 'confirmed');
      return BigInt(bal.value.amount);
    } catch {
      return 0n;
    }
  }

  private async getMintProgram(mint: PublicKey): Promise<PublicKey> {
    const key = mint.toBase58();
    const cached = this.mintProgramCache.get(key);
    if (cached) return cached;
    const info = await this.connection.getAccountInfo(mint, 'confirmed');
    if (!info) throw new Error(`Mint account not found: ${key}`);
    if (!info.owner.equals(TOKEN_PROGRAM_ID) && !info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      throw new Error(`Mint ${key} owned by unexpected program ${info.owner.toBase58()}`);
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
        console.warn('[Huma] Failed to compress with LUTs, sending uncompressed:', (err as Error).message);
      }
    }

    const compiled = compileTransaction(transactionMessage);
    return getBase64EncodedWireTransaction(compiled);
  }
}

export default HumaManager;
