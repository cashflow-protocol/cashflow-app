import { prop, getModelForClass, index, modelOptions } from '@typegoose/typegoose';

export enum FeeTransactionStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
}

export enum FeeType {
  PROFIT = 'profit',
  VAULT_CREATION = 'vault_creation',
}

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'fee_transactions',
  },
})
@index({ walletAddress: 1, mint: 1 })
@index({ withdrawTransactionId: 1 })
export class FeeTransaction {
  @prop({ required: true })
  public walletAddress!: string;

  @prop({ required: true })
  public mint!: string;

  @prop({ required: true, enum: FeeType, default: FeeType.PROFIT })
  public feeType!: FeeType;

  /** Reference to the withdrawal Transaction._id (profit fees only) */
  @prop()
  public withdrawTransactionId?: string;

  /** Raw withdrawal amount (bigint as string, profit fees only) */
  @prop()
  public withdrawAmount?: string;

  /** Computed marginal profit on this withdrawal (bigint as string, profit fees only) */
  @prop()
  public profitAmount?: string;

  /** Fee charged (bigint as string) */
  @prop({ required: true })
  public feeAmount!: string;

  /** On-chain signature (vault creation fees) */
  @prop()
  public signature?: string;

  @prop({ required: true, enum: FeeTransactionStatus, default: FeeTransactionStatus.PENDING })
  public status!: FeeTransactionStatus;
}

export const FeeTransactionModel = getModelForClass(FeeTransaction);
