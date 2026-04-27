import { useState, useEffect, useCallback } from 'react';
import apiService from '../services/apiService';
import type { TaskWithProgress } from '../types/rewards';
import { logError } from '../services/analyticsService';

export interface CashflowPassportState {
  address: string | null;
  activated: boolean;
  activatedAt: string | null;
  /** Lamports the user pays to mint their Passport. Sourced from the backend
   *  (env: CASHFLOW_PASSPORT_ACTIVATION_FEE_LAMPORTS) on every /tasks fetch.
   *  Empty string means we haven't received the value yet — UI should show
   *  a loading placeholder rather than guess. */
  feeLamports: string;
}

const DEFAULT_CASHFLOW_PASSPORT: CashflowPassportState = {
  address: null,
  activated: false,
  activatedAt: null,
  feeLamports: '',
};

let cachedTasks: TaskWithProgress[] | null = null;
let cachedCashflowPassport: CashflowPassportState | null = null;
const refreshListeners = new Set<() => void>();

/** Invalidate the rewards cache and trigger a refresh on all mounted hooks. */
export function invalidateRewards(): void {
  cachedTasks = null;
  cachedCashflowPassport = null;
  refreshListeners.forEach((fn) => fn());
}

export function useRewards() {
  const [tasks, setTasks] = useState<TaskWithProgress[]>(cachedTasks ?? []);
  const [cashflowPassport, setCashflowPassport] = useState<CashflowPassportState>(cachedCashflowPassport ?? DEFAULT_CASHFLOW_PASSPORT);
  const [loading, setLoading] = useState(cachedTasks === null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const fetched = await apiService.getRewardTasks();
      // Coalesce so an old backend (or partial response) can't crash the UI.
      const passport = fetched.cashflowPassport ?? DEFAULT_CASHFLOW_PASSPORT;
      cachedTasks = fetched.tasks;
      cachedCashflowPassport = passport;
      setTasks(fetched.tasks);
      setCashflowPassport(passport);
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

  return { tasks, cashflowPassport, loading, refreshing, error, refresh };
}
