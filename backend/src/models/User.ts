import { prop, getModelForClass, modelOptions, index } from '@typegoose/typegoose';

@modelOptions({
  schemaOptions: {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'users',
  },
})
@index({ vaultAddress: 1 }, { unique: true })
@index({ waitlistUserId: 1 }, { sparse: true })
@index({ publicKey: 1 }, { unique: true })
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

  @prop()
  public seekerAttestedAt?: Date;

  /** Metaplex Core asset address for the user's "Cashflow Passport" — the
   *  single NFT that hosts earned-badge entries via the Attributes
   *  plugin. Set on activation confirm; absent until the user has activated. */
  @prop()
  public cashflowPassportAddress?: string;

  /** When the Cashflow Passport activation was confirmed onchain. */
  @prop()
  public cashflowPassportActivatedAt?: Date;
}

export const UserModel = getModelForClass(User);
