import { prop, getModelForClass, index, modelOptions } from '@typegoose/typegoose';

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'cached_tokens',
  },
})
@index({ mint: 1 }, { unique: true })
@index({ updatedAt: 1 })
export class CachedToken {
  @prop({ required: true })
  public mint!: string;

  @prop({ required: true })
  public symbol!: string;

  @prop({ required: true })
  public name!: string;

  @prop({ required: true })
  public decimals!: number;

  @prop({ default: '' })
  public logoUrl!: string;

  @prop({ default: false })
  public isVerified!: boolean;

  @prop({ type: () => [String], default: [] })
  public tags!: string[];

  @prop({ default: 0 })
  public usdPrice!: number;

  @prop({ type: () => Object })
  public jupiterData?: Record<string, any>;
}

export const CachedTokenModel = getModelForClass(CachedToken);
