import { prop, getModelForClass, index, modelOptions } from '@typegoose/typegoose';
import { SUPPORTED_TOKENS_BY_MINT } from '../constants';
import { EarnTokenType } from '../types';

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'earn_tokens',
    toJSON: {
      transform: (_doc, ret) => {
        const { _id, __v, jupiterToken, kaminoToken, kaminoMultiplyToken, driftToken, perenaToken, solomonToken, onreToken, humaToken, createdAt, updatedAt, ...fields } = ret;
        const { logoUrl, ...tokenInfo } = SUPPORTED_TOKENS_BY_MINT[fields.mint] ?? {};
        return { ...fields, ...tokenInfo };
      },
    },
  },
})
@index({ type: 1, mint: 1, vaultAddress: 1 }, { unique: true })
@index({ status: 1, type: 1 })
@index({ status: 1, rewardsRate: -1 })
@index({ type: 1, vaultAddress: 1 })
@index({ vaultAddress: 1 })
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

  /** Minimum app build number required to render this vault. Builds below this
   *  number get the vault filtered out of /earn/v1/tokens. */
  @prop()
  public minAppBuild?: number;

  /** Semantic tags for client-side filtering (e.g. 'yield-stable'). Empty/unset by default. */
  @prop({ type: () => [String], default: [] })
  public categories?: string[];

  @prop({ type: () => Object })
  public jupiterToken?: Record<string, any>;

  @prop({ type: () => Object })
  public kaminoToken?: Record<string, any>;

  @prop({ type: () => Object })
  public kaminoMultiplyToken?: Record<string, any>;

  /** Mobile-facing config for leveraged loop rows. Returned by /earn/v1/tokens so
   *  the client can render two-token icons, leverage range, and liquidation LTV. */
  @prop({ type: () => Object })
  public multiply?: {
    collMint: string;
    collSymbol: string;
    collDecimals: number;
    collLogoUrl?: string;
    debtMint: string;
    debtSymbol: string;
    debtDecimals: number;
    defaultDepositMint: string;
    leverageRange: { min: number; max: number; default: number };
    apyAtDefault: number;
    liquidationLtv: number;
  };

  @prop({ type: () => Object })
  public driftToken?: Record<string, any>;

  @prop({ type: () => Object })
  public perenaToken?: Record<string, any>;

  @prop({ type: () => Object })
  public solomonToken?: Record<string, any>;

  @prop({ type: () => Object })
  public onreToken?: Record<string, any>;

  @prop({ type: () => Object })
  public humaToken?: Record<string, any>;

  @prop()
  public protocolName?: string;

  @prop()
  public protocolIconUrl?: string;
}

export const EarnTokenModel = getModelForClass(EarnToken);
