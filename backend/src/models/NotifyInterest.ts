import { prop, getModelForClass, modelOptions, index } from '@typegoose/typegoose';

@modelOptions({
  schemaOptions: {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'notify_interests',
  },
})
@index({ userId: 1, protocol: 1 }, { unique: true })
export class NotifyInterest {
  @prop({ required: true })
  public userId!: string;

  @prop({ required: true })
  public protocol!: string;

  @prop()
  public protocolName?: string;
}

export const NotifyInterestModel = getModelForClass(NotifyInterest);
