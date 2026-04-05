import { prop, getModelForClass, index, modelOptions } from '@typegoose/typegoose';

export enum VaultPaymentStatus {
  PENDING = 'pending',
  USED = 'used',
  FAILED = 'failed',
}

export enum VaultMode {
  STANDARD = 'standard',
  SEEKER = 'seeker',
  ANDROID_GMS = 'android_gms',
}

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'vault_payments',
  },
})
@index({ paymentId: 1 }, { unique: true })
export class VaultPayment {
  @prop({ required: true })
  public paymentId!: string;

  @prop({ required: true })
  public platform!: string;

  @prop({ required: true, enum: VaultMode })
  public mode!: VaultMode;

  @prop({ required: true, enum: VaultPaymentStatus, default: VaultPaymentStatus.PENDING })
  public status!: VaultPaymentStatus;

  @prop()
  public cloudKey?: string;

  @prop({ required: true })
  public deviceKey!: string;

  @prop()
  public walletAddress?: string;

  @prop()
  public multisigAddress?: string;

  @prop()
  public vaultAddress?: string;

  @prop()
  public txSignature?: string;
}

export const VaultPaymentModel = getModelForClass(VaultPayment);
