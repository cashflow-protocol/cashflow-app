import { prop, getModelForClass, modelOptions, index } from '@typegoose/typegoose';

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'waitlist_users',
  },
})
@index({ publicKey: 1 }, { unique: true })
@index({ xp: -1 })
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
  public discordId?: string;

  @prop()
  public discordUsername?: string;

  @prop()
  public telegramId?: string;

  @prop()
  public telegramUsername?: string;

  @prop({ type: () => [String], default: [] })
  public completedTasks!: string[];
}

export const WaitlistUserModel = getModelForClass(WaitlistUser);
