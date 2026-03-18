import { prop, getModelForClass, modelOptions, index } from '@typegoose/typegoose';

@modelOptions({
  schemaOptions: {
    timestamps: { createdAt: true, updatedAt: true },
    collection: 'device_tokens',
  },
})
@index({ userId: 1, deviceId: 1 }, { unique: true })
@index({ userId: 1 })
@index({ fcmToken: 1 })
export class DeviceToken {
  @prop({ required: true })
  public userId!: string;

  @prop({ required: true })
  public deviceId!: string;

  @prop({ required: true })
  public fcmToken!: string;
}

export const DeviceTokenModel = getModelForClass(DeviceToken);
