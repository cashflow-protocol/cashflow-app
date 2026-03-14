import { prop, getModelForClass, modelOptions, index } from '@typegoose/typegoose';

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'invite_codes',
  },
})
@index({ code: 1 }, { unique: true })
export class InviteCode {
  @prop({ required: true })
  public code!: string;

  @prop({ required: true, default: false })
  public used!: boolean;

  @prop()
  public usedBy?: string;

  @prop()
  public usedAt?: Date;

  @prop({ required: true })
  public source!: string;
}

export const InviteCodeModel = getModelForClass(InviteCode);
