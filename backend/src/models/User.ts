import { prop, getModelForClass, modelOptions, index } from '@typegoose/typegoose';

@modelOptions({
  schemaOptions: {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'users',
  },
})
@index({ vaultAddress: 1 }, { unique: true })
@index({ waitlistUserId: 1 }, { sparse: true })
@index({ createdAt: -1 })
export class User {
  @prop({ required: true })
  public vaultAddress!: string;

  @prop({ required: true })
  public publicKey!: string;

  @prop({ required: true, default: () => new Date() })
  public lastSeenAt!: Date;

  @prop()
  public inviteCode?: string;

  @prop()
  public waitlistUserId?: string;

  @prop({ type: () => [String], default: [] })
  public fcmTokens!: string[];
}

export const UserModel = getModelForClass(User);
