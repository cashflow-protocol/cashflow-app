import { prop, getModelForClass, modelOptions, index } from '@typegoose/typegoose';

export enum MintedBadgeStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
}

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'minted_badges',
  },
})
@index({ vaultAddress: 1, taskSlug: 1 }, { unique: true })
@index({ assetAddress: 1 }, { unique: true, sparse: true })
@index({ taskSlug: 1, mintedSequence: 1 })
@index({ status: 1, createdAt: 1 })
export class MintedBadge {
  @prop({ required: true })
  public vaultAddress!: string;

  @prop({ required: true })
  public taskSlug!: string;

  /** Position in supply (1..maxSupply) */
  @prop({ required: true })
  public mintedSequence!: number;

  /** Metaplex Core asset pubkey */
  @prop({ required: true })
  public assetAddress!: string;

  @prop({ required: true })
  public collectionAddress!: string;

  @prop({ required: true, enum: MintedBadgeStatus, default: MintedBadgeStatus.PENDING })
  public status!: MintedBadgeStatus;

  @prop({ type: () => [String], default: [] })
  public bundleSignatures!: string[];

  /** Fee paid in lamports (bigint as string) */
  @prop({ required: true })
  public feeAmount!: string;

  @prop()
  public unsignedTransactionId?: string;
}

export const MintedBadgeModel = getModelForClass(MintedBadge);
