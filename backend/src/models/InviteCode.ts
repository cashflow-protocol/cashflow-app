import { prop, getModelForClass, modelOptions, index } from '@typegoose/typegoose';

class InviteCodeUsage {
  @prop({ required: true })
  public publicKey!: string;

  @prop({ required: true, default: () => new Date() })
  public usedAt!: Date;
}

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'invite_codes',
  },
})
@index({ code: 1 }, { unique: true })
@index({ createdAt: -1 })
export class InviteCode {
  @prop({ required: true })
  public code!: string;

  @prop({ required: true, default: 1 })
  public maxUses!: number;

  @prop({ required: true, default: 0 })
  public useCount!: number;

  @prop({ type: () => [InviteCodeUsage], default: [] })
  public usedBy!: InviteCodeUsage[];

  @prop({ required: true })
  public source!: string;
}

export const InviteCodeModel = getModelForClass(InviteCode);
