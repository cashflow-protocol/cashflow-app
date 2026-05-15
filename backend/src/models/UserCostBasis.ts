import { prop, getModelForClass, index, modelOptions } from '@typegoose/typegoose';

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'user_cost_basis',
  },
})
@index({ vaultAddress: 1, mint: 1 }, { unique: true })
export class UserCostBasis {
  @prop({ required: true })
  public vaultAddress!: string;

  @prop({ required: true })
  public mint!: string;

  /** Cumulative raw amount deposited (bigint as string) */
  @prop({ required: true, default: '0' })
  public totalDeposited!: string;

  /** Cumulative raw amount withdrawn (bigint as string) */
  @prop({ required: true, default: '0' })
  public totalWithdrawn!: string;
}

export const UserCostBasisModel = getModelForClass(UserCostBasis);
