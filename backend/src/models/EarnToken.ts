import { prop, getModelForClass, index, modelOptions } from '@typegoose/typegoose';
import { SUPPORTED_TOKENS_BY_MINT } from '../constants';
import { EarnTokenType } from '../types';

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'earn_tokens',
    toJSON: {
      transform: (_doc, ret) => {
        const { _id, __v, jupiterToken, kaminoToken, driftToken, createdAt, updatedAt, ...fields } = ret;
        const { logoUrl, ...tokenInfo } = SUPPORTED_TOKENS_BY_MINT[fields.mint] ?? {};
        return { ...fields, ...tokenInfo };
      },
    },
  },
})
@index({ type: 1, mint: 1, vaultAddress: 1 }, { unique: true })
@index({ status: 1, type: 1 })
@index({ type: 1, symbol: 1 })
@index({ symbol: 1 })
export class EarnToken {
  @prop({ required: true, enum: EarnTokenType })
  public type!: EarnTokenType;

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

  @prop({ required: true, enum: ['active', 'inactive'], default: 'inactive' })
  public status!: 'active' | 'inactive';

  @prop({ default: '0' })
  public minDepositAmount?: string;

  @prop({ default: '0' })
  public minWithdrawAmount?: string;

  @prop({ type: () => Object })
  public jupiterToken?: Record<string, any>;

  @prop({ type: () => Object })
  public kaminoToken?: Record<string, any>;

  @prop({ type: () => Object })
  public driftToken?: Record<string, any>;
}

export const EarnTokenModel = getModelForClass(EarnToken);
