'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api/client';

export interface Currency { code: string; name: string }
export interface Attraction { attractionId: string; name: string; cityId: string }

let currenciesCache: Promise<Currency[]> | null = null;
let attractionsCache: Promise<Attraction[]> | null = null;

const loadCurrencies = () => (currenciesCache ??= apiClient<Currency[]>('/currencies').catch(error => { currenciesCache = null; throw error; }));
const loadAttractions = () => (attractionsCache ??= apiClient<Attraction[]>('/attractions').catch(error => { attractionsCache = null; throw error; }));

/** GEN-12/PDF 5.1 official currencies and attractions; FX itself stays on the backend (ITN-18). */
export function useItineraryCatalog() {
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [attractions, setAttractions] = useState<Attraction[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    Promise.all([loadCurrencies(), loadAttractions()])
      .then(([loadedCurrencies, loadedAttractions]) => {
        if (!alive) return;
        setCurrencies(loadedCurrencies);
        setAttractions(loadedAttractions);
      })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : 'The currency list could not be loaded.'); });
    return () => { alive = false; };
  }, []);
  return { currencies, attractions, error };
}
