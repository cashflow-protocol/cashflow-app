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
  getBase64Encoder,
  AccountRole,
} from '@solana/kit';
import type { Rpc, SolanaRpcApi, TransactionSigner } from '@solana/kit';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { SUPPORTED_TOKEN_MINTS } from '../constants';
import { EarnTokenType } from '../types';
import type { SerializedInstruction } from '../types';
import { DBManager, EarnTokenUpsert } from './DBManager';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

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

export interface JupiterPosition {
  token: JupiterEarnTokenResponse;
  ownerAddress: string;
  shares: string;
  underlyingAssets: string;
  underlyingBalance: string;
  allowance: string;
}

export interface JupiterTokenStats {
  priceChange: number;
  liquidityChange: number;
  volumeChange: number;
  buyVolume: number;
  sellVolume: number;
  buyOrganicVolume: number;
  sellOrganicVolume: number;
  numBuys: number;
  numSells: number;
  numTraders: number;
  numOrganicBuyers: number;
  numNetBuyers: number;
}

export interface JupiterTokenInfo {
  id: string;
  name: string;
  symbol: string;
  icon: string;
  decimals: number;
  circSupply: number;
  totalSupply: number;
  tokenProgram: string;
  firstPool: { id: string; createdAt: string } | null;
  holderCount: number;
  audit: {
    mintAuthorityDisabled: boolean;
    freezeAuthorityDisabled: boolean;
    topHoldersPercentage: number;
  };
  organicScore: number;
  organicScoreLabel: string;
  isVerified: boolean;
  tags: string[];
  fdv: number;
  mcap: number;
  usdPrice: number;
  priceBlockId: number;
  liquidity: number;
  stats5m: JupiterTokenStats;
  stats1h: JupiterTokenStats;
  stats6h: JupiterTokenStats;
  stats24h: JupiterTokenStats;
  updatedAt: string;
}

interface InstructionResponse {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}

interface InstructionsResponse {
  instructions: InstructionResponse[];
}

export class JupiterManager {
  private api: AxiosInstance;
  private rpc: Rpc<SolanaRpcApi>;
  private db: DBManager;
  private readonly baseURL = 'https://api.jup.ag';

  constructor() {
    const apiKey = process.env.JUPITER_API_KEY;
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

    if (!apiKey) {
      console.warn('Warning: JUPITER_API_KEY not set in environment variables');
    }

    this.rpc = createSolanaRpc(rpcUrl);
    this.db = new DBManager();

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
      // console.log('Jupiter Lend Earn Tokens:', JSON.stringify(response.data, null, 2));

      // Save tokens to MongoDB
      await this.saveTokensToDatabase(response.data);

      return response.data;
    } catch (error) {
      console.error('Error fetching Jupiter earn tokens:', error);
      throw error;
    }
  }

  /**
   * Get wallet positions from Jupiter Lend API
   */
  async getWalletPositions(walletAddress: string): Promise<JupiterPosition[]> {
    try {
      const response = await this.api.get<JupiterPosition[]>('/lend/v1/earn/positions', {
        params: { users: walletAddress },
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching Jupiter wallet positions:', error);
      throw error;
    }
  }

  /**
   * Get raw deposit instructions for Jupiter Lend (used by Squads vault flow).
   * @param templateSigner If provided, calls Jupiter API with this address
   *   (e.g. dev wallet) then replaces with ownerAddress in the returned instructions.
   *   Needed because Jupiter API rejects PDAs as signers.
   */
  async getDepositInstructions(
    mint: string,
    amount: string,
    ownerAddress: string,
    templateSigner?: string,
  ): Promise<SerializedInstruction[]> {
    const apiSigner = templateSigner || ownerAddress;

    console.log(`[JupiterManager.getDepositInstructions] asset=${mint}, signer=${apiSigner}, amount=${amount}, ownerAddress=${ownerAddress}, templateSigner=${templateSigner}`);

    const response = await this.api.post<InstructionsResponse>(
      '/lend/v1/earn/deposit-instructions',
      { asset: mint, signer: apiSigner, amount },
    );

    console.log(`[JupiterManager.getDepositInstructions] Jupiter API returned ${response.data.instructions?.length ?? 'undefined'} instructions`);

    let jupiterIxs: SerializedInstruction[] = response.data.instructions;
    let ataCreateIxs: SerializedInstruction[] = [];

    if (templateSigner && templateSigner !== ownerAddress) {
      const result = await this.replaceAuthority(jupiterIxs, templateSigner, ownerAddress, [mint]);
      jupiterIxs = result.instructions;

      // Create ATAs for any new token accounts the vault PDA needs
      const signer = this.createNoopSigner(ownerAddress);
      for (const { ata, mint: ataMint } of result.newAtas) {
        // Skip wSOL ATA — Jupiter handles wSOL creation/closing internally
        if (mint === SOL_MINT && ataMint === SOL_MINT) continue;
        ataCreateIxs.push(this.kitIxToSerialized(
          getCreateAssociatedTokenIdempotentInstruction({
            payer: signer,
            ata: address(ata),
            owner: address(ownerAddress),
            mint: address(ataMint),
          }),
        ));
      }
    }

    // Jupiter's deposit instruction handles wSOL wrapping + closing internally
    // (its instruction includes ATA program, System program, and Token program).
    // Don't add our own wrap/close — it causes a double-close error.
    console.log(`[JupiterManager.getDepositInstructions] Returning ${ataCreateIxs.length + jupiterIxs.length} total instructions (ataCreate=${ataCreateIxs.length}, jupiterIxs=${jupiterIxs.length})`);
    return [...ataCreateIxs, ...jupiterIxs];
  }

  /**
   * Get raw withdraw instructions for Jupiter Lend (used by Squads vault flow).
   * @param templateSigner See getDepositInstructions.
   */
  async getWithdrawInstructions(
    mint: string,
    amount: string,
    ownerAddress: string,
    templateSigner?: string,
  ): Promise<SerializedInstruction[]> {
    const apiSigner = templateSigner || ownerAddress;

    const response = await this.api.post<InstructionsResponse>(
      '/lend/v1/earn/withdraw-instructions',
      { asset: mint, signer: apiSigner, amount },
    );

    let jupiterIxs: SerializedInstruction[] = response.data.instructions;
    let ataCreateIxs: SerializedInstruction[] = [];

    if (templateSigner && templateSigner !== ownerAddress) {
      const result = await this.replaceAuthority(jupiterIxs, templateSigner, ownerAddress, [mint]);
      jupiterIxs = result.instructions;

      // Create ATAs for any new token accounts the vault PDA needs
      const signer = this.createNoopSigner(ownerAddress);
      for (const { ata, mint: ataMint } of result.newAtas) {
        if (mint === SOL_MINT && ataMint === SOL_MINT) continue;
        ataCreateIxs.push(this.kitIxToSerialized(
          getCreateAssociatedTokenIdempotentInstruction({
            payer: signer,
            ata: address(ata),
            owner: address(ownerAddress),
            mint: address(ataMint),
          }),
        ));
      }
    }

    // Jupiter's withdraw instruction handles wSOL unwrapping + closing internally
    // (its instruction includes ATA program, System program, and Token program).
    // Don't add our own closeAccount — it causes a double-close error.
    return [...ataCreateIxs, ...jupiterIxs];
  }

  /**
   * Get an unsigned deposit transaction from Jupiter Lend
   * For SOL deposits, wraps native SOL → wSOL before depositing.
   */
  async deposit(mint: string, amount: string, walletAddress: string): Promise<string> {
    try {
      const response = await this.api.post<InstructionsResponse>(
        '/lend/v1/earn/deposit-instructions',
        { asset: mint, signer: walletAddress, amount },
      );

      // Jupiter handles wSOL wrapping/closing internally — no extra wrap/close needed
      return await this.buildTransaction(response.data.instructions, walletAddress);
    } catch (error) {
      console.error('Error creating Jupiter deposit transaction:', error);
      throw error;
    }
  }

  /**
   * Get an unsigned withdraw transaction from Jupiter Lend
   * For SOL withdrawals, unwraps wSOL → native SOL after withdrawing.
   */
  async withdraw(mint: string, amount: string, walletAddress: string): Promise<string> {
    try {
      const response = await this.api.post<InstructionsResponse>(
        '/lend/v1/earn/withdraw-instructions',
        { asset: mint, signer: walletAddress, amount },
      );

      // Jupiter handles wSOL unwrapping/closing internally — no extra close needed
      return await this.buildTransaction(response.data.instructions, walletAddress);
    } catch (error) {
      console.error('Error creating Jupiter withdraw transaction:', error);
      throw error;
    }
  }

  /**
   * Fetch token information from Jupiter Tokens V2 API by mint addresses.
   * Batches into chunks of 100 (Jupiter API limit) with parallel requests.
   */
  async getTokensByMints(mints: string[]): Promise<JupiterTokenInfo[]> {
    const BATCH_SIZE = 100;
    const chunks: string[][] = [];
    for (let i = 0; i < mints.length; i += BATCH_SIZE) {
      chunks.push(mints.slice(i, i + BATCH_SIZE));
    }

    const results = await Promise.all(
      chunks.map((chunk) =>
        this.api.get<JupiterTokenInfo[]>('/tokens/v2/search', {
          params: { query: chunk.join(',') },
        }),
      ),
    );

    return results.flatMap((r) => r.data);
  }

  private createNoopSigner(walletAddr: string): TransactionSigner {
    return {
      address: address(walletAddr),
      signTransactions: async (txs: any[]) => txs.map(() => ({})),
    } as TransactionSigner;
  }

  /**
   * Convert an instruction response into a base64-encoded unsigned versioned transaction
   */
  private async buildTransaction(
    ixs: InstructionResponse[],
    feePayer: string,
    preInstructions: any[] = [],
    postInstructions: any[] = [],
  ): Promise<string> {
    const jupiterIxs = ixs.map((ix) => ({
      programAddress: address(ix.programId),
      accounts: ix.accounts.map((acc) => ({
        address: address(acc.pubkey),
        role: acc.isSigner && acc.isWritable
          ? AccountRole.WRITABLE_SIGNER
          : acc.isSigner
            ? AccountRole.READONLY_SIGNER
            : acc.isWritable
              ? AccountRole.WRITABLE
              : AccountRole.READONLY,
      })),
      data: getBase64Encoder().encode(ix.data),
    }));

    const allInstructions = [...preInstructions, ...jupiterIxs, ...postInstructions];

    const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();

    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayer(address(feePayer), tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (tx) => allInstructions.reduce((msg: any, ix) => appendTransactionMessageInstruction(ix, msg), tx),
    );

    const compiled = compileTransaction(transactionMessage);
    return getBase64EncodedWireTransaction(compiled);
  }

  /**
   * Replace a template signer address (and its derived ATAs) with the real
   * owner address in a set of instructions.  Used when Jupiter API can't
   * accept a PDA as signer — we call with a normal wallet then swap here.
   */
  private async replaceAuthority(
    instructions: SerializedInstruction[],
    oldAuthority: string,
    newAuthority: string,
    additionalMints: string[] = [],
  ): Promise<{ instructions: SerializedInstruction[]; newAtas: Array<{ ata: string; mint: string }> }> {
    const replacements = new Map<string, string>();
    replacements.set(oldAuthority, newAuthority);

    // Collect every unique address that appears in any account slot
    const allAddresses = new Set<string>();
    for (const ix of instructions) {
      for (const acc of ix.accounts) {
        allAddresses.add(acc.pubkey);
      }
    }

    // Also include caller-supplied mints (e.g. SOL_MINT) — Token::Transfer
    // doesn't list the mint in its accounts, so ATA detection misses it.
    const potentialMints = new Set([...allAddresses, ...additionalMints]);

    // For each address that could be a mint, check whether there's a
    // matching ATA derived from oldAuthority.  If so, compute the
    // replacement ATA derived from newAuthority.
    const newAtas: Array<{ ata: string; mint: string }> = [];
    for (const potentialMint of potentialMints) {
      const [oldAta] = await findAssociatedTokenPda({
        owner: address(oldAuthority),
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
        mint: address(potentialMint),
      });

      if (allAddresses.has(oldAta as string) && !replacements.has(oldAta as string)) {
        const [newAta] = await findAssociatedTokenPda({
          owner: address(newAuthority),
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
          mint: address(potentialMint),
        });
        replacements.set(oldAta as string, newAta as string);
        newAtas.push({ ata: newAta as string, mint: potentialMint });
      }
    }

    // Log all replacements for debugging
    console.log(`[replaceAuthority] replacements:`);
    for (const [from, to] of replacements) {
      console.log(`  ${from} → ${to}`);
    }

    // Log any instruction accounts that are NOT being replaced
    const unreplaced = new Set<string>();
    for (const ix of instructions) {
      for (const acc of ix.accounts) {
        if (!replacements.has(acc.pubkey) && acc.pubkey !== oldAuthority) {
          unreplaced.add(acc.pubkey);
        }
      }
    }
    if (unreplaced.size > 0) {
      console.log(`[replaceAuthority] unreplaced accounts (${unreplaced.size}):`);
      for (const addr of unreplaced) {
        console.log(`  ${addr}`);
      }
    }

    // Log raw Jupiter instructions for debugging
    console.log(`[replaceAuthority] raw Jupiter instructions (${instructions.length}):`);
    for (let i = 0; i < instructions.length; i++) {
      const ix = instructions[i];
      console.log(`  ix[${i}] program=${ix.programId} accounts=${ix.accounts.length} data=${ix.data.length}b`);
      for (const acc of ix.accounts) {
        const replaced = replacements.has(acc.pubkey);
        console.log(`    ${acc.pubkey} signer=${acc.isSigner} writable=${acc.isWritable}${replaced ? ' → REPLACED' : ''}`);
      }
    }

    const replacedInstructions = instructions.map((ix) => ({
      ...ix,
      accounts: ix.accounts.map((acc) => {
        const replacement = replacements.get(acc.pubkey);
        return replacement ? { ...acc, pubkey: replacement } : acc;
      }),
    }));

    return { instructions: replacedInstructions, newAtas };
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

  private async saveTokensToDatabase(tokens: JupiterEarnTokenResponse[]): Promise<void> {
    const upserts: EarnTokenUpsert[] = tokens
      .filter((token) => SUPPORTED_TOKEN_MINTS.includes(token.asset.address))
      .map((token) => ({
        type: EarnTokenType.JUPITER,
        mint: token.asset.address,
        vaultAddress: token.address,
        vaultTitle: `Jupiter Lend - ${token.asset.symbol}`,
        symbol: token.asset.symbol,
        rewardsRate: parseFloat(token.totalRate),
        protocolData: token,
      }));

    await this.db.upsertEarnTokens(upserts);
  }
}

export default JupiterManager;
