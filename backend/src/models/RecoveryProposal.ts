import { prop, getModelForClass, modelOptions, index } from '@typegoose/typegoose';

export enum RecoveryProposalStatus {
  PENDING = 'pending',
  READY = 'ready',
  EXECUTED = 'executed',
  EXPIRED = 'expired',
}

export class RecoverySigner {
  @prop({ required: true })
  public address!: string;

  @prop({ required: true })
  public type!: 'mwa' | 'cloud' | 'privy' | 'external';

  @prop()
  public label?: string;

  @prop()
  public email?: string;
}

export class CollectedSignature {
  @prop({ required: true })
  public address!: string;

  @prop({ required: true })
  public signature!: string; // base64

  @prop({ default: () => new Date() })
  public collectedAt!: Date;
}

export class AddMemberAction {
  @prop({ required: true })
  public memberAddress!: string;

  @prop({ required: true })
  public permissions!: 'all' | 'vote' | 'execute';
}

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'recovery_proposals',
  },
})
@index({ multisigAddress: 1 })
@index({ status: 1 })
export class RecoveryProposal {
  @prop({ required: true })
  public multisigAddress!: string;

  @prop({ required: true })
  public vaultAddress!: string;

  @prop({ required: true })
  public transactionIndex!: number;

  @prop({ required: true })
  public threshold!: number;

  @prop({ required: true, type: () => [AddMemberAction] })
  public actions!: AddMemberAction[];

  /** Serialized TX1 message bytes (base64) — signers sign this */
  @prop({ required: true })
  public tx1MessageBase64!: string;

  /** Full serialized TX1 (base64) with empty signature slots */
  @prop({ required: true })
  public tx1Base64!: string;

  /** Full serialized TX2 (base64) — execute + close + tip */
  @prop({ required: true })
  public tx2Base64!: string;

  @prop({ required: true })
  public blockhash!: string;

  @prop({ required: true, type: () => [RecoverySigner] })
  public requiredSigners!: RecoverySigner[];

  @prop({ type: () => [CollectedSignature], default: [] })
  public collectedSignatures!: CollectedSignature[];

  @prop({ required: true, enum: RecoveryProposalStatus, default: RecoveryProposalStatus.PENDING })
  public status!: RecoveryProposalStatus;

  @prop({ required: true })
  public createdByWallet!: string;

  @prop()
  public executionSignature?: string;
}

export const RecoveryProposalModel = getModelForClass(RecoveryProposal);
