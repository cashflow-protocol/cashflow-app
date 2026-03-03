import { useState, useEffect, useCallback } from 'react';
import apiService from '../services/apiService';

export function useSolPrice() {
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPrice = useCallback(async () => {
    try {
      const solPrice = await apiService.getSolPrice();
      if (solPrice > 0) {
        setPrice(solPrice);
      }
    } catch {
      // Silent fail — price display will show "--"
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrice();
    const interval = setInterval(fetchPrice, 30_000);
    return () => clearInterval(interval);
  }, [fetchPrice]);

  return { price, loading };
}
