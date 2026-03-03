import { useState, useEffect, useCallback } from 'react';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const PRICE_URL = `https://api.jup.ag/price/v2?ids=${SOL_MINT}`;

export function useSolPrice() {
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPrice = useCallback(async () => {
    try {
      const res = await fetch(PRICE_URL);
      const json = await res.json();
      const raw = json?.data?.[SOL_MINT]?.price;
      if (raw != null) {
        setPrice(parseFloat(raw));
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
