import { prop, getModelForClass, modelOptions, index } from '@typegoose/typegoose';

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'waitlist',
  },
})
@index({ email: 1 }, { unique: true })
export class WaitlistEntry {
  @prop({ required: true })
  public email!: string;

  @prop({ required: true, default: false })
  public verified!: boolean;
}

export const WaitlistEntryModel = getModelForClass(WaitlistEntry);