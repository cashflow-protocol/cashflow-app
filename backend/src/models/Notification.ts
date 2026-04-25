import { prop, getModelForClass, modelOptions, index } from '@typegoose/typegoose';

export enum NotificationType {
  TRANSFER_IN = 'transfer_in',
  TRANSFER_OUT = 'transfer_out',
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
  WAITLIST_APPROVED = 'waitlist_approved',
  SYSTEM = 'system',
  BADGE_MINTED = 'badge_minted',
}

@modelOptions({
  schemaOptions: {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'notifications',
  },
})
@index({ vaultAddress: 1, createdAt: -1 })
@index({ vaultAddress: 1, read: 1 })
@index({ txSignature: 1 }, { unique: true, sparse: true })
export class Notification {
  @prop({ required: true })
  public userId!: string;

  @prop({ required: true })
  public vaultAddress!: string;

  @prop({ required: true })
  public title!: string;

  @prop()
  public body?: string;

  @prop({ required: true, enum: NotificationType })
  public type!: NotificationType;

  @prop()
  public txSignature?: string;

  @prop({ default: false })
  public read!: boolean;

  @prop({ type: () => Object })
  public metadata?: Record<string, any>;
}

export const NotificationModel = getModelForClass(Notification);
