import {
  EarnTokenModel,
  TransactionModel,
  TransactionAction,
  TransactionStatus,
  CachedTokenModel,
  WaitlistEntryModel,
  UserModel,
  AuthLogModel,
  NotificationModel,
  NotificationType,
  InviteCodeModel,
  WaitlistUserModel,
  WaitlistTaskModel,
  DeviceTokenModel,
  UserCostBasisModel,
  FeeTransactionModel,
  RecoveryProposalModel,
} from '../models';
import { EarnTokenType } from '../types';

export interface EarnTokenUpsert {
  type: EarnTokenType;
  mint: string;
  vaultAddress: string;
  vaultTitle: string;
  symbol: string;
  rewardsRate: number;
  minDepositAmount?: string;
  minWithdrawAmount?: string;
  protocolData?: Record<string, any>;
  protocolName?: string;
  protocolIconUrl?: string;
}

const PROTOCOL_DATA_FIELD: Record<EarnTokenType, string> = {
  [EarnTokenType.JUPITER]: 'jupiterToken',
  [EarnTokenType.KAMINO]: 'kaminoToken',
  [EarnTokenType.DRIFT]: 'driftToken',
  [EarnTokenType.PERENA]: 'perenaToken',
  [EarnTokenType.SOLOMON]: 'solomonToken',
  [EarnTokenType.ONRE]: 'onreToken',
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
              ...(token.minDepositAmount && { minDepositAmount: token.minDepositAmount }),
              ...(token.minWithdrawAmount && { minWithdrawAmount: token.minWithdrawAmount }),
              ...(token.protocolData && { [dataField]: token.protocolData }),
              ...(token.protocolName && { protocolName: token.protocolName }),
              ...(token.protocolIconUrl && { protocolIconUrl: token.protocolIconUrl }),
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
      .select('type mint vaultAddress vaultTitle symbol rewardsRate status minDepositAmount minWithdrawAmount protocolName protocolIconUrl')
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
    feeAmount?: string;
  }) {
    return TransactionModel.create(data);
  }

  /**
   * Update a transaction record with its onchain signature after sending
   */
  async submitTransaction(transactionId: string, signature: string) {
    return TransactionModel.findByIdAndUpdate(transactionId, {
      status: TransactionStatus.SUBMITTED,
      signature,
    });
  }

  /**
   * Submit bundle signatures for a transaction (Squads vault flow)
   */
  async submitBundleTransaction(transactionId: string, signatures: string[]) {
    return TransactionModel.findByIdAndUpdate(transactionId, {
      status: TransactionStatus.SUBMITTED,
      signature: signatures[0],
      bundleSignatures: signatures,
    });
  }

  /**
   * Find a pending/submitted transaction by any of its bundle signatures
   */
  async findTransactionBySignature(signature: string) {
    return TransactionModel.findOne({
      status: { $in: [TransactionStatus.CREATED, TransactionStatus.SUBMITTED] },
      $or: [
        { signature },
        { bundleSignatures: signature },
      ],
    }).lean();
  }

  /**
   * Check if a signature belongs to any known bundle (any status)
   */
  async isSignatureInBundle(signature: string): Promise<boolean> {
    const count = await TransactionModel.countDocuments({
      bundleSignatures: signature,
    });
    return count > 0;
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
   * Create a notification record
   */
  async createNotification(data: {
    userId: string;
    vaultAddress: string;
    title: string;
    body?: string;
    type: NotificationType;
    txSignature?: string;
    metadata?: Record<string, any>;
  }) {
    return NotificationModel.create(data);
  }

  /**
   * Get paginated notifications for a vault address (newest first)
   */
  async getNotifications(vaultAddress: string, limit: number = 20, before?: string) {
    const query: any = { vaultAddress };
    if (before) {
      query._id = { $lt: before };
    }
    return NotificationModel.find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1) // fetch one extra to determine hasMore
      .lean();
  }

  /**
   * Mark notifications as read
   */
  async markNotificationsRead(vaultAddress: string, notificationIds: string[]) {
    return NotificationModel.updateMany(
      { _id: { $in: notificationIds }, vaultAddress },
      { $set: { read: true } },
    );
  }

  /**
   * Get count of unread notifications for a vault address
   */
  async getUnreadCount(vaultAddress: string): Promise<number> {
    return NotificationModel.countDocuments({ vaultAddress, read: false });
  }

  /**
   * Sync MongoDB indexes to match model definitions
   */
  async syncIndexes(): Promise<void> {
    await EarnTokenModel.syncIndexes();
    await TransactionModel.syncIndexes();
    await CachedTokenModel.syncIndexes();
    await WaitlistEntryModel.syncIndexes();
    await UserModel.syncIndexes();
    await AuthLogModel.syncIndexes();
    await InviteCodeModel.syncIndexes();
    await WaitlistUserModel.syncIndexes();
    await WaitlistTaskModel.syncIndexes();
    await NotificationModel.syncIndexes();
    await DeviceTokenModel.syncIndexes();
    await UserCostBasisModel.syncIndexes();
    await FeeTransactionModel.syncIndexes();
    await RecoveryProposalModel.syncIndexes();
  }
}
