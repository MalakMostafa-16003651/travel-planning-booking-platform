import 'server-only';
import { cookies } from 'next/headers';
import { authCookies, backendUrl } from '@/lib/api/upstream';
import type { Itinerary, ItineraryPage } from './types';

const TIMEOUT_MS = 15_000;

export type Loaded<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'unauthenticated' }
  | { kind: 'forbidden' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

/**
 * Reads with the viewer's own auth cookies (if any), never cached. The backend decides
 * ownership/visibility (ACC-11, GEN-10); a private itinerary of someone else is a 404.
 */
async function load<T>(path: string): Promise<Loaded<T>> {
  const jar = await cookies();
  const cookie = authCookies(jar.toString());
  let response: Response;
  try {
    response = await fetch(new URL(`/api${path}`, backendUrl()), {
      headers: cookie ? { Cookie: cookie } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: 'error', message: 'The itinerary service is not responding. Please try again.' };
  }
  if (response.status === 401) return { kind: 'unauthenticated' };
  if (response.status === 403) return { kind: 'forbidden' };
  if (response.status === 404 || response.status === 400) return { kind: 'not-found' };
  if (!response.ok) return { kind: 'error', message: 'This itinerary could not be loaded. Please try again.' };
  return { kind: 'ok', data: (await response.json()) as T };
}

/** ITN-03: the signed-in user's own itineraries, most recently updated first, 10 per page. */
export function loadMyItineraries(page: number): Promise<Loaded<ItineraryPage>> {
  return load(`/itineraries?page=${page}`);
}

/** ITN-03/ITN-21: owner view, or anyone's public view (admins also see hidden public ones). */
export function loadItinerary(id: string): Promise<Loaded<Itinerary>> {
  return load(`/itineraries/${encodeURIComponent(id)}`);
}

/** GEN-12 country catalog for display names; public reference data, cached briefly. */
export async function loadCountryNames(): Promise<Record<string, string>> {
  try {
    const response = await fetch(new URL('/api/countries', backendUrl()), { next: { revalidate: 300 }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) return {};
    const countries = (await response.json()) as { code: string; name: string }[];
    return Object.fromEntries(countries.map(({ code, name }) => [code, name]));
  } catch {
    return {};
  }
}
