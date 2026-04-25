import { prop, getModelForClass, modelOptions, index } from '@typegoose/typegoose';

/**
 * Generic key/value store for runtime-configurable settings that admins
 * can update without redeploying. Values that are present here override
 * environment defaults (see callers for fallback behavior).
 */
@modelOptions({
  schemaOptions: {
    timestamps: true,
    collection: 'app_settings',
  },
})
@index({ key: 1 }, { unique: true })
export class AppSetting {
  @prop({ required: true, unique: true })
  public key!: string;

  @prop({ required: true })
  public value!: string;
}

export const AppSettingModel = getModelForClass(AppSetting);

export const APP_SETTING_KEYS = {
  REWARDS_COLLECTION_ADDRESS: 'rewards_collection_address',
} as const;

/** Look up a setting; returns env fallback if not in DB. Cached briefly. */
const cache = new Map<string, { value: string | null; fetchedAt: number }>();
const CACHE_TTL_MS = 30_000;

export async function getSetting(key: string, envFallback?: string | null): Promise<string | null> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }
  const doc = await AppSettingModel.findOne({ key }).lean();
  const value = doc?.value ?? envFallback ?? null;
  cache.set(key, { value, fetchedAt: Date.now() });
  return value;
}

/** Bypass the cache for a setting (e.g. after admin updates it). */
export function invalidateSettingCache(key: string): void {
  cache.delete(key);
}

export async function setSetting(key: string, value: string): Promise<void> {
  await AppSettingModel.findOneAndUpdate(
    { key },
    { $set: { value } },
    { upsert: true },
  );
  invalidateSettingCache(key);
}
