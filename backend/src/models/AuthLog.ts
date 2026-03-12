import { prop, getModelForClass, modelOptions, index } from '@typegoose/typegoose';

@modelOptions({
  schemaOptions: {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'auth_logs',
  },
})
@index({ publicKey: 1 })
export class AuthLog {
  @prop({ required: true })
  public publicKey!: string;

  @prop()
  public appVersion?: string;

  @prop()
  public buildNumber?: string;

  @prop()
  public osVersion?: string;

  @prop()
  public device?: string;

  @prop()
  public platform?: string;

  @prop()
  public ipAddress?: string;
}

export const AuthLogModel = getModelForClass(AuthLog);
