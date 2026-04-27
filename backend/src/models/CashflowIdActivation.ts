import { prop, getModelForClass, modelOptions, index } from '@typegoose/typegoose';

export enum CashflowIdActivationStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
}

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'cashflow_id_activations',
  },
})
@index({ vaultAddress: 1 }, { unique: true })
@index({ assetAddress: 1 }, { unique: true, sparse: true })
@index({ status: 1, createdAt: 1 })
export class CashflowIdActivation {
  @prop({ required: true })
  public vaultAddress!: string;

  /** Metaplex Core asset pubkey — generated server-side at build time and
   *  used to address the Cashflow ID for the rest of its lifetime. */
  @prop({ required: true })
  public assetAddress!: string;

  @prop({ required: true })
  public collectionAddress!: string;

  @prop({ required: true, enum: CashflowIdActivationStatus, default: CashflowIdActivationStatus.PENDING })
  public status!: CashflowIdActivationStatus;

  @prop({ type: () => [String], default: [] })
  public bundleSignatures!: string[];

  /** Activation fee in lamports (bigint as string) */
  @prop({ required: true })
  public feeAmount!: string;
}

export const CashflowIdActivationModel = getModelForClass(CashflowIdActivation);
