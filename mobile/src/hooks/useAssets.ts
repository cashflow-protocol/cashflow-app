import { useState, useEffect, useCallback } from 'react';
import apiService from '../services/apiService';
import { getVault } from '../services/vaultStorage';
import type { WalletAsset } from '../types/earn';

// Module-level cache — persists across tab switches, cleared on app restart
let cachedAssets: WalletAsset[] | null = null;
let cachedTotalUsdValue: number | null = null;

// Listeners that get notified when cache should be invalidated
const refreshListeners = new Set<() => void>();

/** Invalidate the assets cache and trigger a refresh on all mounted hooks. */
export function invalidateAssets(): void {
  cachedAssets = null;
  cachedTotalUsdValue = null;
  refreshListeners.forEach((fn) => fn());
}

export function useAssets() {
  const [assets, setAssets] = useState<WalletAsset[]>(cachedAssets ?? []);
  const [totalUsdValue, setTotalUsdValue] = useState(cachedTotalUsdValue ?? 0);
  const [loading, setLoading] = useState(cachedAssets === null);
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
      const data = await apiService.getAssets(vault.vaultAddress);
      
      //FAKE AMOUNTS FOR SCREENSHOTS
      const fakeUsdcAmount = 69420 - 2.56;
      data.totalUsdValue += fakeUsdcAmount;
      for (const asset of data.assets) {
        if (asset.symbol == 'USDC'){
          data.totalUsdValue -= asset.uiAmount;
          asset.uiAmount = fakeUsdcAmount;
          asset.usdValue = asset.uiAmount;
          asset.amount = '' + (asset.uiAmount * 1000000)
        }
      }

      cachedAssets = data.assets;
      cachedTotalUsdValue = data.totalUsdValue;
      setAssets(data.assets);
      setTotalUsdValue(data.totalUsdValue);
    } catch (err: any) {
      setError(err.message ?? 'Failed to fetch assets');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (cachedAssets === null) {
      fetchData();
    }
  }, [fetchData]);

  // Listen for external invalidation (e.g. push notification)
  useEffect(() => {
    const listener = () => fetchData(true);
    refreshListeners.add(listener);
    return () => { refreshListeners.delete(listener); };
  }, [fetchData]);

  const refresh = useCallback(() => fetchData(true), [fetchData]);

  return { assets, totalUsdValue, loading, refreshing, error, refresh };
}
