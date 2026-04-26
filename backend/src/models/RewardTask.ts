import { prop, getModelForClass, modelOptions, index } from '@typegoose/typegoose';

export enum RewardVerifierType {
  ONCHAIN_DEPOSIT = 'onchain_deposit',
  ONCHAIN_SWAP_VOLUME = 'onchain_swap_volume',
  ONCHAIN_TRANSFER_OUT = 'onchain_transfer_out',
  DEVICE_SEEKER = 'device_seeker',
  SOCIAL_TWITTER_FOLLOW = 'social_twitter_follow',
  SOCIAL_TWITTER_RETWEET = 'social_twitter_retweet',
  MANUAL = 'manual',
}

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'reward_tasks',
  },
})
@index({ slug: 1 }, { unique: true })
@index({ active: 1, sortOrder: 1 })
@index({ verifierType: 1 })
export class RewardTask {
  @prop({ required: true, unique: true })
  public slug!: string;

  @prop({ required: true })
  public title!: string;

  @prop({ required: true })
  public description!: string;

  @prop({ required: true })
  public imageUrl!: string;

  @prop({ required: true })
  public metadataUri!: string;

  @prop({ required: true, default: true })
  public active!: boolean;

  @prop({ required: true, default: 0 })
  public sortOrder!: number;

  @prop()
  public availableFrom?: Date;

  @prop()
  public availableUntil?: Date;

  @prop()
  public requiresTaskSlug?: string;

  /** Mint fee in lamports (bigint as string) */
  @prop({ required: true, default: '20000000' })
  public mintFeeLamports!: string;

  /** undefined = unlimited */
  @prop()
  public maxSupply?: number;

  /** Atomic counter — incremented at slot claim */
  @prop({ required: true, default: 0 })
  public mintedCount!: number;

  @prop({ required: true, enum: RewardVerifierType })
  public verifierType!: RewardVerifierType;

  /** Schema depends on verifierType — see RewardManager for per-type shapes */
  @prop({ type: () => Object })
  public verifierConfig?: Record<string, any>;
}

export const RewardTaskModel = getModelForClass(RewardTask);
