import { prop, getModelForClass, modelOptions, index } from '@typegoose/typegoose';

export enum CashflowPassportActivationStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
}

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'cashflow_passport_activations',
  },
})
// Not unique — a vault may accumulate multiple FAILED rows from prior
// attempts, plus one in-flight PENDING. The source of truth for "the user
// has activated" is User.cashflowPassportAddress, not this collection.
@index({ vaultAddress: 1, status: 1 })
@index({ assetAddress: 1 }, { unique: true, sparse: true })
@index({ status: 1, createdAt: 1 })
export class CashflowPassportActivation {
  @prop({ required: true })
  public vaultAddress!: string;

  /** Metaplex Core asset pubkey — generated server-side at build time and
   *  used to address the Cashflow Passport for the rest of its lifetime. */
  @prop({ required: true })
  public assetAddress!: string;

  @prop({ required: true })
  public collectionAddress!: string;

  @prop({ required: true, enum: CashflowPassportActivationStatus, default: CashflowPassportActivationStatus.PENDING })
  public status!: CashflowPassportActivationStatus;

  @prop({ type: () => [String], default: [] })
  public bundleSignatures!: string[];

  /** Activation fee in lamports (bigint as string) */
  @prop({ required: true })
  public feeAmount!: string;
}

export const CashflowPassportActivationModel = getModelForClass(CashflowPassportActivation);
