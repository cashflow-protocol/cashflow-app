import { prop, getModelForClass, modelOptions, index } from '@typegoose/typegoose';

export enum ErrorSeverity {
  EXPECTED = 'expected',
  UNEXPECTED = 'unexpected',
  CRITICAL = 'critical',
}

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

@modelOptions({
  schemaOptions: {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'error_logs',
  },
})
@index({ createdAt: 1 }, { expireAfterSeconds: THIRTY_DAYS_SECONDS })
@index({ userId: 1, createdAt: -1 })
@index({ vaultAddress: 1, createdAt: -1 })
@index({ publicKey: 1, createdAt: -1 })
@index({ severity: 1, createdAt: -1 })
@index({ errorName: 1, createdAt: -1 })
@index({ route: 1, statusCode: 1, createdAt: -1 })
export class ErrorLog {
  @prop({ required: true })
  public route!: string;

  @prop({ required: true })
  public fullPath!: string;

  @prop({ required: true })
  public method!: string;

  @prop({ required: true })
  public statusCode!: number;

  @prop({ required: true, enum: ErrorSeverity })
  public severity!: ErrorSeverity;

  @prop({ required: true })
  public errorMessage!: string;

  @prop()
  public errorCode?: string;

  @prop()
  public errorName?: string;

  @prop()
  public stack?: string;

  @prop()
  public sentryEventId?: string;

  @prop()
  public userId?: string;

  @prop()
  public publicKey?: string;

  @prop()
  public vaultAddress?: string;

  @prop({ type: () => Object })
  public requestBody?: Record<string, unknown>;

  @prop({ type: () => Object })
  public requestQuery?: Record<string, unknown>;

  @prop({ type: () => Object })
  public requestParams?: Record<string, unknown>;

  @prop({ type: () => Object })
  public responseBody?: Record<string, unknown>;

  @prop()
  public userAgent?: string;

  @prop()
  public ipAddress?: string;

  @prop()
  public appVersion?: string;

  @prop()
  public buildNumber?: string;

  @prop()
  public platform?: string;

  public createdAt!: Date;
}

export const ErrorLogModel = getModelForClass(ErrorLog);
