import { prop, getModelForClass, modelOptions, index } from '@typegoose/typegoose';

export enum RewardProgressStatus {
  IN_PROGRESS = 'in_progress',
  CLAIMABLE = 'claimable',
  MINT_PENDING = 'mint_pending',
  MINTED = 'minted',
}

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'user_reward_progress',
  },
})
@index({ vaultAddress: 1, taskSlug: 1 }, { unique: true })
@index({ vaultAddress: 1, status: 1 })
@index({ status: 1, taskSlug: 1 })
export class UserRewardProgress {
  @prop({ required: true })
  public vaultAddress!: string;

  @prop({ required: true })
  public taskSlug!: string;

  @prop({ required: true, enum: RewardProgressStatus, default: RewardProgressStatus.IN_PROGRESS })
  public status!: RewardProgressStatus;

  /** Current progress value (bigint as string for amounts, or count as string) */
  @prop({ required: true, default: '0' })
  public currentValue!: string;

  /** Target value copied from task at first read */
  @prop({ required: true })
  public targetValue!: string;

  @prop()
  public completedAt?: Date;

  @prop()
  public lastEvaluatedAt?: Date;

  /** Verifier-specific attestations, e.g. { seeker: { walletAddress, attestedAt } } */
  @prop({ type: () => Object })
  public attestations?: Record<string, any>;
}

export const UserRewardProgressModel = getModelForClass(UserRewardProgress);
