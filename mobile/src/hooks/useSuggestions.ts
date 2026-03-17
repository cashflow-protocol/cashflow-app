import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import apiService from '../services/apiService';
import { getVault } from '../services/vaultStorage';
import { APP_VERSION, BUILD_NUMBER } from '../config/version';
import type { Suggestion } from '../types/earn';
import { logError } from '../services/analyticsService';

let cachedSuggestions: Suggestion[] | null = null;

export function useSuggestions() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>(cachedSuggestions ?? []);
  const [loading, setLoading] = useState(cachedSuggestions === null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const vault = await getVault();

      const data = await apiService.getSuggestions({
        vaultAddress: vault?.vaultAddress,
        walletAddress: vault?.walletAddress,
        appVersion: APP_VERSION,
        buildNumber: BUILD_NUMBER,
        platform: Platform.OS,
        osVersion: DeviceInfo.getSystemVersion() || String(Platform.Version),
        device: `${DeviceInfo.getBrand() || Platform.OS} ${DeviceInfo.getModel() || ''}`.trim(),
      });

      cachedSuggestions = data;
      setSuggestions(data);
    } catch (err: any) {
      logError('suggestions_fetch', err.message || 'unknown');
      console.error('Failed to fetch suggestions:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cachedSuggestions === null) {
      fetchData();
    }
  }, [fetchData]);

  const refresh = useCallback(() => fetchData(true), [fetchData]);

  return { suggestions, loading, refresh };
}
