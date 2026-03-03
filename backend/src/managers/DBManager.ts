import { EarnTokenModel, TransactionModel, TransactionAction, TransactionStatus, CachedTokenModel } from '../models';
import { EarnTokenType } from '../types';

export interface EarnTokenUpsert {
  type: EarnTokenType;
  mint: string;
  vaultAddress: string;
  vaultTitle: string;
  symbol: string;
  rewardsRate: number;
  protocolData?: Record<string, any>;
}

const PROTOCOL_DATA_FIELD: Record<EarnTokenType, string> = {
  [EarnTokenType.JUPITER]: 'jupiterToken',
  [EarnTokenType.KAMINO]: 'kaminoToken',
  [EarnTokenType.DRIFT]: 'driftToken',
};

export class DBManager {
  /**
   * Bulk upsert earn tokens — creates new tokens as 'inactive', updates existing ones
   */
  async upsertEarnTokens(tokens: EarnTokenUpsert[]): Promise<void> {
    if (tokens.length === 0) return;

    const type = tokens[0].type;

    const bulkOps = tokens.map((token) => {
      const dataField = PROTOCOL_DATA_FIELD[token.type];
      return {
        updateOne: {
          filter: {
            type: token.type,
            mint: token.mint,
            vaultAddress: token.vaultAddress,
          },
          update: {
            $set: {
              type: token.type,
              mint: token.mint,
              vaultAddress: token.vaultAddress,
              vaultTitle: token.vaultTitle,
              symbol: token.symbol,
              rewardsRate: token.rewardsRate,
              ...(token.protocolData && { [dataField]: token.protocolData }),
            },
            $setOnInsert: {
              status: 'inactive' as const,
            },
          },
          upsert: true,
        },
      };
    });

    const result = await EarnTokenModel.bulkWrite(bulkOps as any);
    console.log(
      `[${type}] Saved ${result.upsertedCount} new tokens, updated ${result.modifiedCount} existing tokens`
    );
  }

  /**
   * Get active vaults for a given protocol type (lean documents for read-only use)
   */
  async getActiveVaults(type: EarnTokenType) {
    return EarnTokenModel.find({ type, status: 'active' }).lean();
  }

  /**
   * Get tokens for the API response, filtered by status and optional type
   */
  async getTokens(filter?: { type?: string }) {
    const query: any = { status: 'active' };
    if (filter?.type) {
      query.type = filter.type;
    }

    return EarnTokenModel.find(query)
      .select('type mint vaultAddress vaultTitle symbol rewardsRate status')
      .sort({ rewardsRate: -1 });
  }

  /**
   * Create a transaction record when a deposit/withdraw is requested
   */
  async createTransaction(data: {
    action: TransactionAction;
    type?: EarnTokenType;
    mint: string;
    vaultAddress?: string;
    amount: string;
    walletAddress: string;
    destinationAddress?: string;
    unsignedTransaction?: string;
  }) {
    return TransactionModel.create(data);
  }

  /**
   * Update a transaction record with its on-chain signature after sending
   */
  async submitTransaction(transactionId: string, signature: string) {
    return TransactionModel.findByIdAndUpdate(transactionId, {
      status: TransactionStatus.SUBMITTED,
      signature,
    });
  }

  /**
   * Get all transactions that have been submitted but not yet confirmed/failed
   */
  async getSubmittedTransactions() {
    return TransactionModel.find({ status: TransactionStatus.SUBMITTED })
      .select('_id signature updatedAt')
      .lean();
  }

  /**
   * Update transaction status to confirmed or failed
   */
  async confirmTransaction(transactionId: string, status: TransactionStatus.CONFIRMED | TransactionStatus.FAILED) {
    return TransactionModel.findByIdAndUpdate(transactionId, { status });
  }

  /**
   * Sync MongoDB indexes to match model definitions
   */
  async syncIndexes(): Promise<void> {
    await EarnTokenModel.syncIndexes();
    await TransactionModel.syncIndexes();
    await CachedTokenModel.syncIndexes();
  }
}
