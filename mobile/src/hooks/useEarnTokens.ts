import { useState, useEffect, useCallback } from 'react';
import apiService from '../services/apiService';
import type { EarnToken, EarnPosition } from '../types/earn';

// TODO: Replace with actual wallet connection
const HARDCODED_WALLET = '8NZMiChYeGFhrZPSrVMacVXkgvMhK5RvAgQLBcZJUSLp';

export interface EarnTokenWithPosition extends EarnToken {
  position?: EarnPosition;
}

export function useEarnTokens() {
  const [tokens, setTokens] = useState<EarnTokenWithPosition[]>([]);
  const [loading, setLoading] = useState(true);
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
      const [earnTokens, positions] = await Promise.all([
        apiService.getEarnTokens(),
        apiService.getPositions(HARDCODED_WALLET),
      ]);

      const positionMap = new Map<string, EarnPosition>();
      positions.forEach((p) => {
        const key = [p.type, p.mint, p.vaultAddress].filter(Boolean).join(':');
        positionMap.set(key, p);
      });

      const merged: EarnTokenWithPosition[] = earnTokens.map((token) => ({
        ...token,
        position: positionMap.get([token.type, token.mint, token.vaultAddress].filter(Boolean).join(':')),
      }));

      setTokens(merged);
    } catch (err: any) {
      setError(err.message ?? 'Failed to fetch earn tokens');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const refresh = useCallback(() => fetchData(true), [fetchData]);

  return { tokens, loading, refreshing, error, refresh };
}
