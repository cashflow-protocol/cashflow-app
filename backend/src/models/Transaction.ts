import { prop, getModelForClass, index, modelOptions } from '@typegoose/typegoose';
import { EarnTokenType } from '../types';

export enum TransactionAction {
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
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
export class Transaction {
  @prop({ required: true, enum: TransactionAction })
  public action!: TransactionAction;

  @prop({ required: true, enum: EarnTokenType })
  public type!: EarnTokenType;

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
  public signature?: string;

  @prop()
  public unsignedTransaction?: string;
}

export const TransactionModel = getModelForClass(Transaction);
