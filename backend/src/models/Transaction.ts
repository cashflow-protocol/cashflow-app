import { prop, getModelForClass, index, modelOptions } from '@typegoose/typegoose';
import { EarnTokenType } from '../types';

export enum TransactionAction {
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
  TRANSFER = 'transfer',
}

export enum TransactionStatus {
  CREATED = 'created',
  SUBMITTED = 'submitted',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
}

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'transactions',
  },
})
@index({ walletAddress: 1, status: 1 })
@index({ status: 1 })
@index({ signature: 1 }, { sparse: true })
@index({ bundleSignatures: 1 })
export class Transaction {
  @prop({ required: true, enum: TransactionAction })
  public action!: TransactionAction;

  @prop({ enum: EarnTokenType })
  public type?: EarnTokenType;

  @prop({ required: true })
  public mint!: string;

  @prop()
  public vaultAddress?: string;

  @prop({ required: true })
  public amount!: string;

  @prop({ required: true })
  public walletAddress!: string;

  @prop({ required: true, enum: TransactionStatus, default: TransactionStatus.CREATED })
  public status!: TransactionStatus;

  @prop()
  public destinationAddress?: string;

  @prop()
  public signature?: string;

  @prop({ type: () => [String], default: [] })
  public bundleSignatures!: string[];

  @prop()
  public unsignedTransaction?: string;

  /** Fee amount charged on this withdrawal (bigint as string) */
  @prop()
  public feeAmount?: string;
}

export const TransactionModel = getModelForClass(Transaction);
