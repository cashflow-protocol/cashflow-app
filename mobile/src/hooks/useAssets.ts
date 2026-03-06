import { useState, useEffect, useCallback } from 'react';
import apiService from '../services/apiService';
import { getVault } from '../services/vaultStorage';
import { useWallet } from './useWallet';
import type { WalletAsset } from '../types/earn';

// Module-level cache — persists across tab switches, cleared on app restart
let cachedAssets: WalletAsset[] | null = null;
let cachedTotalUsdValue: number | null = null;

export function useAssets() {
  const { wallet } = useWallet();
  const connectedAddress = wallet?.publicKey as string | undefined;
  const [assets, setAssets] = useState<WalletAsset[]>(cachedAssets ?? []);
  const [totalUsdValue, setTotalUsdValue] = useState(cachedTotalUsdValue ?? 0);
  const [loading, setLoading] = useState(cachedAssets === null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!connectedAddress) return;
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const vault = await getVault();
      const walletAddress = vault?.vaultAddress ?? connectedAddress;
      const data = await apiService.getAssets(walletAddress);

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
  }, [connectedAddress]);

  useEffect(() => {
    if (cachedAssets === null) {
      fetchData();
    }
  }, [fetchData]);

  const refresh = useCallback(() => fetchData(true), [fetchData]);

  return { assets, totalUsdValue, loading, refreshing, error, refresh };
}
