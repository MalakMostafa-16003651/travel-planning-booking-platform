"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api/client";

export interface City {
  cityId: string;
  name: string;
  countryCode: string;
}
export interface Country {
  code: string;
  name: string;
  currency: string;
}

let citiesCache: Promise<City[]> | null = null;
let countriesCache: Promise<Country[]> | null = null;

function loadCities(): Promise<City[]> {
  citiesCache ??= apiClient<City[]>("/cities").catch(error => { citiesCache = null; throw error; });
  return citiesCache;
}
function loadCountries(): Promise<Country[]> {
  countriesCache ??= apiClient<Country[]>("/countries").catch(error => { countriesCache = null; throw error; });
  return countriesCache;
}

/** GEN-12: official seeded cities/countries, same catalog HTL-11 search resolves destinations against. */
export function useDestinations() {
  const [cities, setCities] = useState<City[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.all([loadCities(), loadCountries()])
      .then(([loadedCities, loadedCountries]) => {
        if (!alive) return;
        setCities(loadedCities);
        setCountries(loadedCountries);
      })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "Could not load destinations."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return { cities, countries, loading, error };
}
