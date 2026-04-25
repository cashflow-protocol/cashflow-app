import { useState, useEffect, useCallback } from 'react';
import apiService from '../services/apiService';
import type { TaskWithProgress } from '../types/rewards';
import { logError } from '../services/analyticsService';
import { getVault } from '../services/vaultStorage';
import { executeVaultTransaction } from '../services/squadsService';

let cachedTasks: TaskWithProgress[] | null = null;
const refreshListeners = new Set<() => void>();

/** Invalidate the rewards cache and trigger a refresh on all mounted hooks. */
export function invalidateRewards(): void {
  cachedTasks = null;
  refreshListeners.forEach((fn) => fn());
}

export function useRewards() {
  const [tasks, setTasks] = useState<TaskWithProgress[]>(cachedTasks ?? []);
  const [loading, setLoading] = useState(cachedTasks === null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const fetched = await apiService.getRewardTasks();
      cachedTasks = fetched;
      setTasks(fetched);
    } catch (err: any) {
      logError('rewards_fetch', err.message ?? 'unknown');
      setError(err.message ?? 'Failed to fetch rewards');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (cachedTasks === null) fetchData();
  }, [fetchData]);

  useEffect(() => {
    const listener = () => fetchData(true);
    refreshListeners.add(listener);
    return () => { refreshListeners.delete(listener); };
  }, [fetchData]);

  const refresh = useCallback(() => fetchData(true), [fetchData]);

  const mint = useCallback(async (taskSlug: string): Promise<{ assetAddress: string; signature: string }> => {
    const vault = await getVault();
    if (!vault?.multisigAddress) throw new Error('No vault found');

    const built = await apiService.mintRewardBadge(taskSlug);

    // Wrap fee transfer inner instructions in vault TX1-TX4 and append
    // the pre-signed Metaplex Core mint TX as TX5.
    const result = await executeVaultTransaction(
      vault.multisigAddress,
      built.innerInstructions,
      undefined,
      undefined,
      [built.mintTransactionBase64],
    );

    // Best-effort confirmation hint to backend (recovery cron is the failsafe)
    apiService.confirmRewardMint(built.mintedBadgeId, result.bundleSignatures).catch(() => {});

    invalidateRewards();
    return { assetAddress: built.assetAddress, signature: result.signature };
  }, []);

  return { tasks, loading, refreshing, error, refresh, mint };
}
