import { useState, useEffect, useCallback } from 'react';
import apiService from '../services/apiService';
import { useWallet } from './useWallet';
import type { EarnToken, EarnPosition } from '../types/earn';

export interface EarnTokenWithPosition extends EarnToken {
  position?: EarnPosition;
}

export function useEarnTokens() {
  const { wallet } = useWallet();
  const [tokens, setTokens] = useState<EarnTokenWithPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [earnTokens, positions] = await Promise.all([
        apiService.getEarnTokens(),
        wallet?.publicKey
          ? apiService.getPositions(wallet.publicKey)
          : Promise.resolve([]),
      ]);

      const positionMap = new Map<string, EarnPosition>();
      positions.forEach((p) => {
        const key = `${p.type}:${p.mint}`;
        positionMap.set(key, p);
      });

      const merged: EarnTokenWithPosition[] = earnTokens.map((token) => ({
        ...token,
        position: positionMap.get(`${token.type}:${token.mint}`),
      }));

      setTokens(merged);
    } catch (err: any) {
      setError(err.message ?? 'Failed to fetch earn tokens');
    } finally {
      setLoading(false);
    }
  }, [wallet?.publicKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { tokens, loading, error, refresh: fetchData };
}
