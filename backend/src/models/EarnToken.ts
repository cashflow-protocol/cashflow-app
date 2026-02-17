import { prop, getModelForClass, index, modelOptions } from '@typegoose/typegoose';

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'earn_tokens',
  },
})
@index({ type: 1, mint: 1, vaultAddress: 1 }, { unique: true })
@index({ type: 1, symbol: 1 })
@index({ symbol: 1 })
export class EarnToken {
  @prop({ required: true, enum: ['jupiter', 'kamino', 'drift'] })
  public type!: 'jupiter' | 'kamino' | 'drift';

  @prop({ required: true })
  public mint!: string;

  @prop({ required: true })
  public vaultAddress!: string;

  @prop({ required: true })
  public vaultTitle!: string;

  @prop({ required: true })
  public symbol!: string;

  @prop({ required: true })
  public rewardsRate!: number;

  @prop({ type: () => Object })
  public jupiterToken?: Record<string, any>;

  @prop({ type: () => Object })
  public kaminoToken?: Record<string, any>;
}

export const EarnTokenModel = getModelForClass(EarnToken);
