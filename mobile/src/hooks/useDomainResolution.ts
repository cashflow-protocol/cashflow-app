import { useEffect, useRef, useState } from 'react';
import apiService from '../services/apiService';

const DOMAIN_REGEX = /^[a-z0-9-]+\.(sol|skr)$/i;
const DEBOUNCE_MS = 350;

export interface DomainResolution {
  isDomain: boolean;
  resolving: boolean;
  resolvedAddress: string | null;
  error: string | null;
}

export function useDomainResolution(input: string): DomainResolution {
  const trimmed = input.trim().toLowerCase();
  const isDomain = DOMAIN_REGEX.test(trimmed);

  const [resolving, setResolving] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeDomain = useRef<string | null>(null);

  useEffect(() => {
    if (!isDomain) {
      activeDomain.current = null;
      setResolving(false);
      setResolvedAddress(null);
      setError(null);
      return;
    }

    activeDomain.current = trimmed;
    setResolving(true);
    setResolvedAddress(null);
    setError(null);

    const timer = setTimeout(async () => {
      const domain = trimmed;
      try {
        const addr = await apiService.resolveName(domain);
        if (activeDomain.current !== domain) return;
        if (addr) {
          setResolvedAddress(addr);
        } else {
          setError('Domain not found');
        }
      } catch {
        if (activeDomain.current !== domain) return;
        setError("Couldn't resolve domain");
      } finally {
        if (activeDomain.current === domain) {
          setResolving(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [trimmed, isDomain]);

  return { isDomain, resolving, resolvedAddress, error };
}
