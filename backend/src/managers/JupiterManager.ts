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
import type { Rpc, SolanaRpcApi } from '@solana/kit';
import { EarnTokenModel } from '../models';
import { SUPPORTED_TOKEN_MINTS } from '../constants';

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
  private readonly baseURL = 'https://api.jup.ag';

  constructor() {
    const apiKey = process.env.JUPITER_API_KEY;
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

    if (!apiKey) {
      console.warn('Warning: JUPITER_API_KEY not set in environment variables');
    }

    this.rpc = createSolanaRpc(rpcUrl);

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
   * Get an unsigned deposit transaction from Jupiter Lend
   * @param mint Token mint address
   * @param amount Deposit amount in raw token units
   * @param walletAddress Wallet address (overrides env default)
   */
  async deposit(mint: string, amount: string, walletAddress: string): Promise<string> {
    try {
      const response = await this.api.post<InstructionsResponse>(
        '/lend/v1/earn/deposit-instructions',
        { asset: mint, signer: walletAddress, amount },
      );
      return await this.buildTransaction(response.data.instructions, walletAddress);
    } catch (error) {
      console.error('Error creating Jupiter deposit transaction:', error);
      throw error;
    }
  }

  /**
   * Get an unsigned withdraw transaction from Jupiter Lend
   * @param mint Token mint address
   * @param amount Withdrawal amount in raw token units
   * @param walletAddress Wallet address (overrides env default)
   */
  async withdraw(mint: string, amount: string, walletAddress: string): Promise<string> {
    try {
      const response = await this.api.post<InstructionsResponse>(
        '/lend/v1/earn/withdraw-instructions',
        { asset: mint, signer: walletAddress, amount },
      );
      return await this.buildTransaction(response.data.instructions, walletAddress);
    } catch (error) {
      console.error('Error creating Jupiter withdraw transaction:', error);
      throw error;
    }
  }

  /**
   * Convert an instruction response into a base64-encoded unsigned versioned transaction
   */
  private async buildTransaction(ixs: InstructionResponse[], feePayer: string): Promise<string> {
    const instructions = ixs.map((ix) => ({
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

  /**
   * Save or update earn tokens in MongoDB
   * @param tokens Array of Jupiter earn tokens
   */
  private async saveTokensToDatabase(tokens: JupiterEarnTokenResponse[]): Promise<void> {
    try {
      const supportedTokens = tokens.filter((token) =>
        SUPPORTED_TOKEN_MINTS.includes(token.asset.address)
      );

      const bulkOps = supportedTokens.map((token) => ({
        updateOne: {
          filter: {
            type: 'jupiter' as const,
            mint: token.asset.address,
            vaultAddress: token.address,
          },
          update: {
            $set: {
              type: 'jupiter' as const,
              mint: token.asset.address,
              vaultAddress: token.address,
              vaultTitle: `Jupiter Lend - ${token.asset.symbol}`,
              symbol: token.asset.symbol,
              rewardsRate: parseFloat(token.totalRate),
              jupiterToken: token,
            },
            $setOnInsert: {
              status: 'inactive' as const,
            },
          },
          upsert: true, // Create if doesn't exist, update if exists
        },
      }));

      const result = await EarnTokenModel.bulkWrite(bulkOps as any);

      console.log(`✅ Saved ${result.upsertedCount} new tokens, updated ${result.modifiedCount} existing tokens`);
    } catch (error) {
      console.error('Error saving tokens to database:', error);
      throw error;
    }
  }
}

export default JupiterManager;
