import { prop, getModelForClass, index, modelOptions } from '@typegoose/typegoose';

export enum FeeTransactionStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
}

export enum FeeType {
  VAULT_CREATION = 'vault_creation',
}

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'fee_transactions',
  },
})
@index({ vaultAddress: 1, mint: 1 })
export class FeeTransaction {
  @prop({ required: true })
  public vaultAddress!: string;

  @prop({ required: true })
  public mint!: string;

  @prop({ required: true, enum: FeeType, default: FeeType.VAULT_CREATION })
  public feeType!: FeeType;

  /** Fee charged (bigint as string) */
  @prop({ required: true })
  public feeAmount!: string;

  /** onchain signature (vault creation fees) */
  @prop()
  public signature?: string;

  @prop({ required: true, enum: FeeTransactionStatus, default: FeeTransactionStatus.PENDING })
  public status!: FeeTransactionStatus;
}

export const FeeTransactionModel = getModelForClass(FeeTransaction);
