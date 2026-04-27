import { prop, getModelForClass, modelOptions, index } from '@typegoose/typegoose';

export enum BadgeMintAttemptStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
}

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'badge_mint_attempts',
  },
})
@index({ vaultAddress: 1, taskSlug: 1, status: 1 })
@index({ status: 1, createdAt: 1 })
export class BadgeMintAttempt {
  @prop({ required: true })
  public vaultAddress!: string;

  @prop({ required: true })
  public taskSlug!: string;

  /** Cashflow Passport asset that the badge attribute is being appended to. */
  @prop({ required: true })
  public assetAddress!: string;

  @prop({ required: true })
  public collectionAddress!: string;

  @prop({ required: true, enum: BadgeMintAttemptStatus, default: BadgeMintAttemptStatus.PENDING })
  public status!: BadgeMintAttemptStatus;

  @prop({ type: () => [String], default: [] })
  public bundleSignatures!: string[];

  /** Gas reimbursement paid by vault → admin in lamports (bigint as string). */
  @prop({ required: true })
  public feeAmount!: string;
}

export const BadgeMintAttemptModel = getModelForClass(BadgeMintAttempt);
