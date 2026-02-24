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
  getSyncNativeInstruction,
  getCloseAccountInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
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
      console.log('Jupiter Lend Earn Tokens:', JSON.stringify(response.data, null, 2));

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
   * Get raw deposit instructions for Jupiter Lend (used by Squads vault flow)
   */
  async getDepositInstructions(mint: string, amount: string, ownerAddress: string): Promise<SerializedInstruction[]> {
    const response = await this.api.post<InstructionsResponse>(
      '/lend/v1/earn/deposit-instructions',
      { asset: mint, signer: ownerAddress, amount },
    );

    const jupiterIxs: SerializedInstruction[] = response.data.instructions;

    if (mint === SOL_MINT) {
      const { preIxs, postIxs } = await this.buildSolWrapIxs(ownerAddress, BigInt(amount));
      return [
        ...preIxs.map((ix: any) => this.kitIxToSerialized(ix)),
        ...jupiterIxs,
        ...postIxs.map((ix: any) => this.kitIxToSerialized(ix)),
      ];
    }

    return jupiterIxs;
  }

  /**
   * Get raw withdraw instructions for Jupiter Lend (used by Squads vault flow)
   */
  async getWithdrawInstructions(mint: string, amount: string, ownerAddress: string): Promise<SerializedInstruction[]> {
    const response = await this.api.post<InstructionsResponse>(
      '/lend/v1/earn/withdraw-instructions',
      { asset: mint, signer: ownerAddress, amount },
    );

    const jupiterIxs: SerializedInstruction[] = response.data.instructions;

    if (mint === SOL_MINT) {
      const { postIxs } = await this.buildSolWrapIxs(ownerAddress);
      return [
        ...jupiterIxs,
        ...postIxs.map((ix: any) => this.kitIxToSerialized(ix)),
      ];
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
        // Jupiter already creates the wSOL ATA — just close it after to unwrap
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
   * Build SOL wrap/unwrap instructions.
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
