import { prop, getModelForClass, index, modelOptions } from '@typegoose/typegoose';

export enum FeeTransactionStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
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

  /** Reference to the withdrawal Transaction._id */
  @prop({ required: true })
  public withdrawTransactionId!: string;

  /** Raw withdrawal amount (bigint as string) */
  @prop({ required: true })
  public withdrawAmount!: string;

  /** Computed marginal profit on this withdrawal (bigint as string) */
  @prop({ required: true })
  public profitAmount!: string;

  /** Fee charged: 10% of profit (bigint as string) */
  @prop({ required: true })
  public feeAmount!: string;

  @prop({ required: true, enum: FeeTransactionStatus, default: FeeTransactionStatus.PENDING })
  public status!: FeeTransactionStatus;
}

export const FeeTransactionModel = getModelForClass(FeeTransaction);
