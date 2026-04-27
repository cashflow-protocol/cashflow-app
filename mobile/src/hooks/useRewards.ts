import { useState, useEffect, useCallback } from 'react';
import apiService from '../services/apiService';
import type { TaskWithProgress } from '../types/rewards';
import { logError } from '../services/analyticsService';

export interface CashflowIdState {
  address: string | null;
  activated: boolean;
  activatedAt: string | null;
  feeLamports: string;
}

const DEFAULT_CASHFLOW_ID: CashflowIdState = {
  address: null,
  activated: false,
  activatedAt: null,
  feeLamports: '20000000',
};

let cachedTasks: TaskWithProgress[] | null = null;
let cachedCashflowId: CashflowIdState | null = null;
const refreshListeners = new Set<() => void>();

/** Invalidate the rewards cache and trigger a refresh on all mounted hooks. */
export function invalidateRewards(): void {
  cachedTasks = null;
  cachedCashflowId = null;
  refreshListeners.forEach((fn) => fn());
}

export function useRewards() {
  const [tasks, setTasks] = useState<TaskWithProgress[]>(cachedTasks ?? []);
  const [cashflowId, setCashflowId] = useState<CashflowIdState>(cachedCashflowId ?? DEFAULT_CASHFLOW_ID);
  const [loading, setLoading] = useState(cachedTasks === null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const fetched = await apiService.getRewardTasks();
      cachedTasks = fetched.tasks;
      cachedCashflowId = fetched.cashflowId;
      setTasks(fetched.tasks);
      setCashflowId(fetched.cashflowId);
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

  return { tasks, cashflowId, loading, refreshing, error, refresh };
}
