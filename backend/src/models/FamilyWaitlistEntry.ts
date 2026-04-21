import { prop, getModelForClass, modelOptions, index } from '@typegoose/typegoose';

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'family_waitlist',
  },
})
@index({ email: 1 }, { unique: true })
export class FamilyWaitlistEntry {
  @prop({ required: true })
  public email!: string;

  @prop({ required: true, default: false })
  public verified!: boolean;

  // Survey — all optional, strings so we can add options without a migration
  @prop() public gender?: string;
  @prop() public ageRange?: string;
  @prop() public familyStatus?: string;
  @prop() public numberOfKids?: number;
  @prop() public jointSavingsAccount?: boolean;
  @prop({ type: () => [String] }) public savingsMethods?: string[];
  @prop() public monthlySavingsAmount?: string;
  @prop() public cryptoComfort?: string;
  @prop({ type: () => [String] }) public defiProtocols?: string[];
  @prop({ type: () => [String] }) public currentGoals?: string[];
  @prop({ type: () => [String] }) public futureGoals?: string[];
  @prop() public savingsChallenge?: string;
  @prop() public surveyCompletedAt?: Date;

  // Payment — optional 5 USDC early-access
  @prop({ default: false }) public paid?: boolean;
  @prop() public paidAmount?: number;
  @prop() public paidTxSignature?: string;
  @prop() public paidAt?: Date;
  @prop() public paidWalletAddress?: string;
  @prop() public paidNonce?: string;
}

export const FamilyWaitlistEntryModel = getModelForClass(FamilyWaitlistEntry);
