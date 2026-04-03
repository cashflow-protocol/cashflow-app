import { prop, getModelForClass, modelOptions, index, Severity } from '@typegoose/typegoose';

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'waitlist_users',
  },
})
@index({ publicKey: 1 }, { unique: true })
@index({ status: 1, xp: -1, lastXpAt: 1 })
@index({ xp: -1, lastXpAt: 1 })
export class WaitlistUser {
  @prop({ required: true })
  public publicKey!: string;

  @prop({ required: true, default: 0 })
  public xp!: number;

  @prop({ required: true, default: 'waiting' })
  public status!: string;

  @prop()
  public inviteCode?: string;

  @prop()
  public approvedAt?: Date;

  @prop()
  public email?: string;

  @prop({ default: false })
  public emailVerified?: boolean;

  @prop()
  public twitterId?: string;

  @prop()
  public twitterHandle?: string;

  @prop()
  public twitterAccessToken?: string;

  @prop()
  public twitterRefreshToken?: string;

  @prop()
  public discordId?: string;

  @prop()
  public discordUsername?: string;

  @prop()
  public telegramId?: string;

  @prop()
  public telegramUsername?: string;

  @prop()
  public walletAddress?: string;

  @prop({ default: () => new Date() })
  public lastXpAt!: Date;

  @prop({ type: () => [String], default: [] })
  public completedTasks!: string[];

  @prop({ type: () => [Object], default: [], allowMixed: Severity.ALLOW })
  public proofScreenshots!: { taskId: string; imageUrl: string; uploadedAt: Date }[];

  @prop({ type: () => [String], default: [] })
  public fcmTokens!: string[];
}

export const WaitlistUserModel = getModelForClass(WaitlistUser);
