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
  getCloseAccountInstruction,
  getSyncNativeInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { getTransferSolInstruction } from '@solana-program/system';
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
   * Uses templateSigner for the API call (Jupiter rejects PDAs), then replaces
   * all occurrences of templateSigner and its derived ATAs with ownerAddress.
   * For SOL deposits, prepends wSOL wrapping instructions (create ATA + fund + syncNative).
   */
  async getDepositInstructions(
    mint: string,
    amount: string,
    ownerAddress: string,
    templateSigner: string,
  ): Promise<SerializedInstruction[]> {
    console.log(`[JupiterManager.getDepositInstructions] asset=${mint}, owner=${ownerAddress}, apiSigner=${templateSigner}, amount=${amount}`);

    const response = await this.api.post<InstructionsResponse>(
      '/lend/v1/earn/deposit-instructions',
      { asset: mint, signer: templateSigner, amount },
    );

    // Replace template signer and its ATAs with the real owner (vault PDA)
    const jupiterIxs = (await this.replaceAuthority(response.data.instructions, templateSigner, ownerAddress, mint))
      .map(ix => this.makeAtaIdempotent(ix));
    console.log(`[JupiterManager.getDepositInstructions] Jupiter returned ${response.data.instructions.length} ixs, after replacement: ${jupiterIxs.length}`);

    // For SOL deposits: create + fund the wSOL ATA before calling Jupiter's deposit.
    // Jupiter's onchain program expects a pre-funded depositorTokenAccount (wSOL ATA).
    // These instructions are built directly with the real owner — no replacement needed.
    if (mint === SOL_MINT) {
      const signer = this.createNoopSigner(ownerAddress);
      const solMint = address(SOL_MINT);
      const owner = address(ownerAddress);
      const [wsolAta] = await findAssociatedTokenPda({
        owner, tokenProgram: TOKEN_PROGRAM_ADDRESS, mint: solMint,
      });

      const wrapIxs: SerializedInstruction[] = [
        this.kitIxToSerialized(getCreateAssociatedTokenIdempotentInstruction({
          payer: signer, ata: wsolAta, owner, mint: solMint,
        })),
        this.kitIxToSerialized(getTransferSolInstruction({
          source: signer, destination: wsolAta, amount: BigInt(amount),
        })),
        this.kitIxToSerialized(getSyncNativeInstruction({ account: wsolAta })),
      ];

      console.log(`[JupiterManager.getDepositInstructions] SOL deposit: ${wrapIxs.length} wrap + ${jupiterIxs.length} jupiter = ${wrapIxs.length + jupiterIxs.length} total`);
      return [...wrapIxs, ...jupiterIxs];
    }

    return jupiterIxs;
  }

  /**
   * Get raw withdraw instructions for Jupiter Lend (used by Squads vault flow).
   * Uses templateSigner for the API call, then replaces with ownerAddress.
   */
  async getWithdrawInstructions(
    mint: string,
    amount: string,
    ownerAddress: string,
    templateSigner: string,
  ): Promise<SerializedInstruction[]> {
    console.log(`[JupiterManager.getWithdrawInstructions] asset=${mint}, owner=${ownerAddress}, apiSigner=${templateSigner}, amount=${amount}`);

    const response = await this.api.post<InstructionsResponse>(
      '/lend/v1/earn/withdraw-instructions',
      { asset: mint, signer: templateSigner, amount },
    );

    const jupiterIxs = (await this.replaceAuthority(response.data.instructions, templateSigner, ownerAddress, mint))
      .map(ix => this.makeAtaIdempotent(ix));

    // For SOL withdrawals: close the wSOL ATA to unwrap back to native SOL
    if (mint === SOL_MINT) {
      const signer = this.createNoopSigner(ownerAddress);
      const owner = address(ownerAddress);
      const [wsolAta] = await findAssociatedTokenPda({
        owner, tokenProgram: TOKEN_PROGRAM_ADDRESS, mint: address(SOL_MINT),
      });

      const closeIx = this.kitIxToSerialized(getCloseAccountInstruction({
        account: wsolAta,
        destination: owner,
        owner: signer,
      }));

      console.log(`[JupiterManager.getWithdrawInstructions] SOL withdraw: ${jupiterIxs.length} jupiter + 1 close = ${jupiterIxs.length + 1} total`);
      return [...jupiterIxs, closeIx];
    }

    return jupiterIxs;
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

      if (mint === SOL_MINT) {
        const { preIxs, postIxs } = await this.buildSolWrapIxs(walletAddress, BigInt(amount));
        return await this.buildTransaction(response.data.instructions, walletAddress, preIxs, postIxs);
      }

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

      if (mint === SOL_MINT) {
        const { postIxs } = await this.buildSolWrapIxs(walletAddress);
        return await this.buildTransaction(response.data.instructions, walletAddress, [], postIxs);
      }

      return await this.buildTransaction(response.data.instructions, walletAddress);
    } catch (error) {
      console.error('Error creating Jupiter withdraw transaction:', error);
      throw error;
    }
  }

  /**
   * Get a swap quote from Jupiter Swap API.
   */
  async getSwapQuote(
    inputMint: string,
    outputMint: string,
    amount: string,
    slippageBps: number = 50,
  ): Promise<{
    outputAmount: string;
    priceImpactPct: number;
    otherAmountThreshold: string;
    routePlan: any[];
    quoteResponse: any;
  }> {
    console.log(`[JupiterManager.getSwapQuote] inputMint=${inputMint}, outputMint=${outputMint}, amount=${amount}, slippageBps=${slippageBps}`);

    // Limit route complexity for Squads vault transactions — the inner message
    // and execute TX must both fit within Solana's 1232-byte transaction limit.
    const response = await this.api.get('/swap/v1/quote', {
      params: { inputMint, outputMint, amount, slippageBps, maxAccounts: 20 },
    });

    const quote = response.data;
    return {
      outputAmount: quote.outAmount,
      priceImpactPct: parseFloat(quote.priceImpactPct || '0'),
      otherAmountThreshold: quote.otherAmountThreshold,
      routePlan: quote.routePlan || [],
      quoteResponse: quote,
    };
  }

  /**
   * Get raw swap instructions for Jupiter Swap (used by Squads vault flow).
   * Uses templateSigner for the API call (Jupiter rejects PDAs), then replaces
   * all occurrences of templateSigner and its derived ATAs with ownerAddress.
   * For SOL input, prepends wSOL wrapping instructions.
   * For SOL output, appends wSOL close instruction.
   */
  async getSwapInstructions(
    inputMint: string,
    outputMint: string,
    amount: string,
    ownerAddress: string,
    templateSigner: string,
    slippageBps: number = 50,
  ): Promise<{
    instructions: SerializedInstruction[];
    extraLookupTables: string[];
    quote: { outputAmount: string; priceImpactPct: number; otherAmountThreshold: string };
  }> {
    console.log(`[JupiterManager.getSwapInstructions] in=${inputMint}, out=${outputMint}, amount=${amount}, owner=${ownerAddress}, apiSigner=${templateSigner}`);

    // 1. Fetch fresh quote
    const { quoteResponse, outputAmount, priceImpactPct, otherAmountThreshold } =
      await this.getSwapQuote(inputMint, outputMint, amount, slippageBps);

    // 2. Get swap instructions from Jupiter
    const response = await this.api.post('/swap/v1/swap-instructions', {
      quoteResponse,
      userPublicKey: templateSigner,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
    });

    const data = response.data;

    // 3. Collect all instructions in execution order
    // NOTE: Skip computeBudgetInstructions — they only work at the top-level
    // transaction, not via CPI. The Squads execute TX sets its own compute budget.
    const rawIxs: SerializedInstruction[] = [];

    if (data.setupInstructions) {
      for (const ix of data.setupInstructions) {
        rawIxs.push({ programId: ix.programId, accounts: ix.accounts, data: ix.data });
      }
    }
    if (data.swapInstruction) {
      const ix = data.swapInstruction;
      rawIxs.push({ programId: ix.programId, accounts: ix.accounts, data: ix.data });
    }
    if (data.cleanupInstruction) {
      const ix = data.cleanupInstruction;
      rawIxs.push({ programId: ix.programId, accounts: ix.accounts, data: ix.data });
    }

    console.log(`[JupiterManager.getSwapInstructions] Jupiter returned ${rawIxs.length} raw instructions`);

    // 4. Replace template signer with real owner (vault PDA)
    const replacedIxs = (await this.replaceAuthority(rawIxs, templateSigner, ownerAddress, inputMint))
      .map(ix => this.makeAtaIdempotent(ix));

    // 5. Handle SOL wrapping/unwrapping
    const finalIxs: SerializedInstruction[] = [];
    const signer = this.createNoopSigner(ownerAddress);
    const owner = address(ownerAddress);

    if (inputMint === SOL_MINT) {
      // Prepend wSOL wrapping instructions for SOL input
      const solMint = address(SOL_MINT);
      const [wsolAta] = await findAssociatedTokenPda({
        owner, tokenProgram: TOKEN_PROGRAM_ADDRESS, mint: solMint,
      });

      finalIxs.push(
        this.kitIxToSerialized(getCreateAssociatedTokenIdempotentInstruction({
          payer: signer, ata: wsolAta, owner, mint: solMint,
        })),
        this.kitIxToSerialized(getTransferSolInstruction({
          source: signer, destination: wsolAta, amount: BigInt(amount),
        })),
        this.kitIxToSerialized(getSyncNativeInstruction({ account: wsolAta })),
      );
    }

    finalIxs.push(...replacedIxs);

    if (outputMint === SOL_MINT) {
      // Append wSOL close instruction for SOL output
      const solMint = address(SOL_MINT);
      const [wsolAta] = await findAssociatedTokenPda({
        owner, tokenProgram: TOKEN_PROGRAM_ADDRESS, mint: solMint,
      });

      finalIxs.push(
        this.kitIxToSerialized(getCloseAccountInstruction({
          account: wsolAta, destination: owner, owner: signer,
        })),
      );
    }

    console.log(`[JupiterManager.getSwapInstructions] Final: ${finalIxs.length} instructions, ${(data.addressLookupTableAddresses || []).length} LUTs`);

    return {
      instructions: finalIxs,
      extraLookupTables: data.addressLookupTableAddresses || [],
      quote: { outputAmount, priceImpactPct, otherAmountThreshold },
    };
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

  /**
   * Build SOL wrap/unwrap instructions (used by legacy non-Squads flows).
   * @param walletAddress The wallet address
   * @param amount If provided, transfer this many lamports into the wSOL ATA (for deposits).
   *               If omitted, only create ATA + close (for withdrawals).
   */
  private async buildSolWrapIxs(walletAddress: string, amount?: bigint) {
    const signer = this.createNoopSigner(walletAddress);
    const solMint = address(SOL_MINT);
    const owner = address(walletAddress);

    const [wsolAta] = await findAssociatedTokenPda({
      owner,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
      mint: solMint,
    });

    const preIxs: any[] = [
      getCreateAssociatedTokenIdempotentInstruction({
        payer: signer,
        ata: wsolAta,
        owner,
        mint: solMint,
      }),
    ];

    if (amount !== undefined) {
      preIxs.push(
        getTransferSolInstruction({
          source: signer,
          destination: wsolAta,
          amount,
        }),
        getSyncNativeInstruction({ account: wsolAta }),
      );
    }

    const postIxs: any[] = [
      getCloseAccountInstruction({
        account: wsolAta,
        destination: owner,
        owner: signer,
      }),
    ];

    return { preIxs, postIxs };
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
   * owner address in a set of serialized instructions.
   */
  private async replaceAuthority(
    instructions: SerializedInstruction[],
    oldAuthority: string,
    newAuthority: string,
    depositMint: string,
  ): Promise<SerializedInstruction[]> {
    const replacements = new Map<string, string>();
    replacements.set(oldAuthority, newAuthority);

    // Collect every unique address that appears in any account slot
    const allAddresses = new Set<string>();
    for (const ix of instructions) {
      for (const acc of ix.accounts) {
        allAddresses.add(acc.pubkey);
      }
    }

    // For each address that could be a mint (including the deposit mint itself),
    // check whether there's a matching ATA derived from oldAuthority.
    // Try both Token and Token2022 programs since fTokens may use either.
    const TOKEN_PROGRAMS = [TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS];
    const potentialMints = new Set([...allAddresses, depositMint]);
    for (const mint of potentialMints) {
      for (const tokenProgram of TOKEN_PROGRAMS) {
        try {
          const [oldAta] = await findAssociatedTokenPda({
            owner: address(oldAuthority),
            tokenProgram,
            mint: address(mint),
          });

          if (allAddresses.has(oldAta as string) && !replacements.has(oldAta as string)) {
            const [newAta] = await findAssociatedTokenPda({
              owner: address(newAuthority),
              tokenProgram,
              mint: address(mint),
            });
            replacements.set(oldAta as string, newAta as string);
            console.log(`[replaceAuthority] ATA match via ${tokenProgram === TOKEN_2022_PROGRAM_ADDRESS ? 'Token2022' : 'Token'} for mint ${mint}`);
          }
        } catch {
          // Not a valid mint address — skip
        }
      }
    }

    // Diagnostic: check the deposit mint's onchain owner to detect Token2022
    try {
      const mintInfo = await this.rpc.getAccountInfo(address(depositMint), { encoding: 'base64' }).send();
      const mintOwner = mintInfo.value?.owner;
      console.log(`[replaceAuthority] deposit mint ${depositMint} owner=${mintOwner}`);
    } catch { /* diagnostic only */ }

    console.log(`[replaceAuthority] ${replacements.size} replacements:`);
    for (const [from, to] of replacements) {
      console.log(`  ${from} → ${to}`);
    }

    const result = instructions.map((ix) => ({
      ...ix,
      accounts: ix.accounts.map((acc) => {
        const replacement = replacements.get(acc.pubkey);
        return replacement ? { ...acc, pubkey: replacement } : acc;
      }),
    }));

    // Log final instructions for debugging
    for (let i = 0; i < result.length; i++) {
      const ix = result[i];
      console.log(`[replaceAuthority] final ix[${i}] program=${ix.programId} accounts=${ix.accounts.length}`);
      for (const acc of ix.accounts) {
        console.log(`  ${acc.pubkey} signer=${acc.isSigner} writable=${acc.isWritable}`);
      }
    }

    return result;
  }

  /**
   * Convert a non-idempotent CreateAssociatedTokenAccount (0-byte data) to
   * CreateAssociatedTokenIdempotent (1-byte discriminator = 1).
   * Jupiter's API returns non-idempotent ATA creates which fail with IllegalOwner
   * if the account already exists — idempotent is safe in all cases.
   */
  private makeAtaIdempotent(ix: SerializedInstruction): SerializedInstruction {
    const ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
    if (ix.programId === ATA_PROGRAM_ID && Buffer.from(ix.data, 'base64').length === 0) {
      console.log('[makeAtaIdempotent] Converting non-idempotent ATA create → idempotent');
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
        minDepositAmount: '0',
        minWithdrawAmount: '0',
        protocolData: token,
      }));

    await this.db.upsertEarnTokens(upserts);
  }
}

export default JupiterManager;
