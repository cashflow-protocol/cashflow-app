import { prop, getModelForClass, index, modelOptions } from '@typegoose/typegoose';
import { EarnTokenType } from '../types';

export enum TransactionAction {
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
  TRANSFER = 'transfer',
  SWAP = 'swap',
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
@index({ signature: 1, status: 1 }, { sparse: true })
@index({ bundleSignatures: 1 })
@index({ bundleSignatures: 1, status: 1 })
@index({ userVaultAddress: 1, status: 1 })
@index({ userVaultAddress: 1, action: 1, status: 1 })
export class Transaction {
  @prop({ required: true, enum: TransactionAction })
  public action!: TransactionAction;

  @prop({ enum: EarnTokenType })
  public type?: EarnTokenType;

  @prop({ required: true })
  public mint!: string;

  /** Protocol pool vault (Jupiter Lend pool, Kamino vault, etc.) — only set
   *  for deposit/withdraw. Empty for transfer/swap. */
  @prop()
  public vaultAddress?: string;

  /** User's Squads vault PDA — owner of this transaction. Use this for
   *  rewards verification, cost basis, and earnings queries. */
  @prop({ required: true })
  public userVaultAddress!: string;

  @prop({ required: true })
  public amount!: string;

  @prop({ required: true })
  public walletAddress!: string;

  @prop({ required: true, enum: TransactionStatus, default: TransactionStatus.CREATED })
  public status!: TransactionStatus;

  @prop()
  public destinationAddress?: string;

  @prop()
  public outputMint?: string;

  @prop()
  public signature?: string;

  @prop({ type: () => [String], default: [] })
  public bundleSignatures!: string[];

  @prop()
  public unsignedTransaction?: string;
}

export const TransactionModel = getModelForClass(Transaction);
