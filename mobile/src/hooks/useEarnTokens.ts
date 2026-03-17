import { useState, useEffect, useCallback } from 'react';
import apiService from '../services/apiService';
import { getVault } from '../services/vaultStorage';
import type { EarnToken, EarnPosition } from '../types/earn';
import { logError } from '../services/analyticsService';

export interface EarnTokenWithPosition extends EarnToken {
  position?: EarnPosition;
}

// Module-level cache — persists across tab switches, cleared on app restart
let cachedTokens: EarnTokenWithPosition[] | null = null;

function mergeTokensAndPositions(earnTokens: EarnToken[], positions: EarnPosition[]): EarnTokenWithPosition[] {
  // Index positions by exact key (type:mint:vaultAddress) and fallback key (type:mint)
  const exactMap = new Map<string, EarnPosition>();
  const fallbackMap = new Map<string, EarnPosition>();
  positions.forEach((p) => {
    const fallbackKey = `${p.type}:${p.mint}`;
    if (p.vaultAddress) {
      exactMap.set(`${fallbackKey}:${p.vaultAddress}`, p);
    } else {
      fallbackMap.set(fallbackKey, p);
    }
  });

  return earnTokens.map((token) => {
    const exactKey = `${token.type}:${token.mint}:${token.vaultAddress}`;
    const fallbackKey = `${token.type}:${token.mint}`;
    return {
      ...token,
      position: exactMap.get(exactKey) ?? fallbackMap.get(fallbackKey),
    };
  });
}

export function useEarnTokens() {
  const [tokens, setTokens] = useState<EarnTokenWithPosition[]>(cachedTokens ?? []);
  const [loading, setLoading] = useState(cachedTokens === null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const vault = await getVault();
      if (!vault?.vaultAddress) return;
      const [earnTokens, positions] = await Promise.all([
        apiService.getEarnTokens(),
        apiService.getPositions(vault.vaultAddress),
      ]);

      const merged = mergeTokensAndPositions(earnTokens, positions);
      cachedTokens = merged;
      setTokens(merged);
    } catch (err: any) {
      logError('earn_tokens_fetch', err.message ?? 'unknown');
      setError(err.message ?? 'Failed to fetch earn tokens');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (cachedTokens === null) {
      fetchData();
    }
  }, [fetchData]);

  const refresh = useCallback(() => fetchData(true), [fetchData]);

  return { tokens, loading, refreshing, error, refresh };
}
