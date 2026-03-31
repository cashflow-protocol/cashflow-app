import { prop, getModelForClass, modelOptions, index } from '@typegoose/typegoose';

@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'waitlist_tasks',
  },
})
@index({ active: 1, sortOrder: 1 })
@index({ sortOrder: 1 })
@index({ category: 1, 'metadata.provider': 1 })
@index({ category: 1, title: 1 })
export class WaitlistTask {
  @prop({ required: true })
  public title!: string;

  @prop()
  public description?: string;

  @prop({ required: true })
  public xpReward!: number;

  @prop({ required: true, default: true })
  public active!: boolean;

  @prop({ required: true, default: 0 })
  public sortOrder!: number;

  @prop()
  public requiresTask?: string;

  @prop({ required: true })
  public category!: string;

  @prop({ type: () => Object })
  public metadata?: Record<string, any>;
}

export const WaitlistTaskModel = getModelForClass(WaitlistTask);
