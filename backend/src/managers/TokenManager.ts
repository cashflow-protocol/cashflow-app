import { CachedTokenModel } from '../models';
import { JupiterManager, JupiterTokenInfo } from './JupiterManager';

export interface CachedTokenInfo {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string;
  isVerified: boolean;
  tags: string[];
  usdPrice: number;
  jupiterData?: JupiterTokenInfo;
}

const CACHE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

export class TokenManager {
  private jupiter: JupiterManager;

  constructor() {
    this.jupiter = new JupiterManager();
  }

  /**
   * Delete cached tokens older than 1 hour.
   */
  async cleanupStaleCache(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - CACHE_MAX_AGE_MS);
      const result = await CachedTokenModel.deleteMany({ updatedAt: { $lt: cutoff } });
      if (result.deletedCount > 0) {
        console.log(`[TokenManager] Cleaned up ${result.deletedCount} stale cached tokens`);
      }
    } catch (error) {
      console.error('[TokenManager] Cache cleanup error:', error);
    }
  }

  /**
   * Get token info by mint addresses, using MongoDB cache with Jupiter as fallback.
   * Returns a Map keyed by mint address for easy lookup.
   */
  async getTokensByMints(mints: string[]): Promise<Map<string, CachedTokenInfo>> {
    if (mints.length === 0) return new Map();

    const uniqueMints = [...new Set(mints)];

    // 1. Check cache
    const cached = await CachedTokenModel.find({ mint: { $in: uniqueMints } }).lean();
    const result = new Map<string, CachedTokenInfo>();
    for (const token of cached) {
      result.set(token.mint, {
        mint: token.mint,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        logoUrl: token.logoUrl,
        isVerified: token.isVerified,
        tags: token.tags,
        usdPrice: token.usdPrice,
        jupiterData: token.jupiterData as JupiterTokenInfo | undefined,
      });
    }

    // 2. Find missing mints
    const missingMints = uniqueMints.filter((m) => !result.has(m));
    if (missingMints.length === 0) return result;

    // 3. Fetch from Jupiter
    const jupiterTokens = await this.jupiter.getTokensByMints(missingMints);

    // 4. Map and upsert into cache
    if (jupiterTokens.length > 0) {
      const bulkOps = jupiterTokens.map((jt) => ({
        updateOne: {
          filter: { mint: jt.id },
          update: {
            $set: {
              mint: jt.id,
              symbol: jt.symbol,
              name: jt.name,
              decimals: jt.decimals,
              logoUrl: jt.icon ?? '',
              isVerified: jt.isVerified ?? false,
              tags: jt.tags ?? [],
              usdPrice: jt.usdPrice ?? 0,
              jupiterData: jt,
            },
          },
          upsert: true,
        },
      }));

      await CachedTokenModel.bulkWrite(bulkOps as any);

      // 5. Add to result map
      for (const jt of jupiterTokens) {
        result.set(jt.id, {
          mint: jt.id,
          symbol: jt.symbol,
          name: jt.name,
          decimals: jt.decimals,
          logoUrl: jt.icon ?? '',
          isVerified: jt.isVerified ?? false,
          tags: jt.tags ?? [],
          usdPrice: jt.usdPrice ?? 0,
          jupiterData: jt,
        });
      }
    }

    return result;
  }
}
