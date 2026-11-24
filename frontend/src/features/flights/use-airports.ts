'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api/client';
import type { Airport } from '@/lib/flights/types';

let cache: Promise<Airport[]> | null = null;

function loadAirports(): Promise<Airport[]> {
  cache ??= apiClient<Airport[]>('/airports').catch(error => {
    cache = null; // allow a retry after a failure
    throw error;
  });
  return cache;
}

export function useAirports() {
  const [airports, setAirports] = useState<Airport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    loadAirports()
      .then(list => { if (alive) setAirports(list); })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Could not load airports.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  return { airports, loading, error };
}
