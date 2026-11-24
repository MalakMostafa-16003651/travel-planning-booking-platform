import 'server-only';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { loginHref } from '@/config/routes';
import { authCookies, backendUrl } from '@/lib/api/upstream';
import type { Airport, BookingGroup, ChangePolicies, FlightBooking, FlightBookingChange, FlightBookingPage, OfferedFlight, SegmentChoice } from './types';

const TIMEOUT_MS = 15_000;
const MAX_HOLD_PAGES = 5;

/** What a page still has to render itself. */
export type Settled<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string };

export type Loaded<T> = Settled<T> | { kind: 'unauthenticated' } | { kind: 'not-found' };

/** Private reads: the traveler's own cookies, never cached and never shared between requests. */
async function loadPrivate<T>(path: string): Promise<Loaded<T>> {
  const jar = await cookies();
  let response: Response;
  try {
    response = await fetch(new URL(`/api${path}`, backendUrl()), {
      headers: { Cookie: authCookies(jar.toString()) }, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: 'error', message: 'The booking service is not responding. Please try again.' };
  }
  if (response.status === 401) return { kind: 'unauthenticated' };
  if (response.status === 403) return { kind: 'forbidden' };
  if (response.status === 404) return { kind: 'not-found' };
  if (!response.ok) return { kind: 'error', message: 'Your bookings could not be loaded. Please try again.' };
  return { kind: 'ok', data: await response.json() as T };
}

async function loadPublic<T>(path: string, init: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(new URL(`/api${path}`, backendUrl()), { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return response.ok ? await response.json() as T : null;
  } catch {
    return null;
  }
}

export function loadBooking(id: string): Promise<Loaded<FlightBooking>> {
  return loadPrivate(`/flight-bookings/${encodeURIComponent(id)}`);
}

export function loadBookings(group: BookingGroup, page = 1): Promise<Loaded<FlightBookingPage>> {
  return loadPrivate(`/flight-bookings?group=${group}&page=${page}`);
}

export function loadChange(id: string): Promise<Loaded<FlightBookingChange>> {
  return loadPrivate(`/flight-booking-changes/${encodeURIComponent(id)}`);
}

/** Null when unavailable: the change page then asks for a reload instead of letting the traveler accept blindly. */
export async function loadChangePolicies(id: string): Promise<ChangePolicies | null> {
  const result = await loadPrivate<ChangePolicies>(`/bookings/flight-change/${encodeURIComponent(id)}/policies`);
  return result.kind === 'ok' ? result.data : null;
}

/** Seats and prices change constantly, so this is never cached. */
export function loadFlight(id: string): Promise<OfferedFlight | null> {
  return loadPublic(`/flights/${encodeURIComponent(id)}`, { cache: 'no-store' });
}

/** Public reference data; the backend sends max-age=300 for it as well. */
export async function loadAirports(): Promise<Record<string, Airport>> {
  const airports = await loadPublic<Airport[]>('/airports', { next: { revalidate: 300 } });
  return Object.fromEntries((airports ?? []).map(airport => [airport.code, airport]));
}

/** A live hold on exactly these flights and cabins, so the traveler is not asked to hold them twice. */
export async function findLiveHold(segments: SegmentChoice[], now: Date): Promise<FlightBooking | null> {
  for (let page = 1; page <= MAX_HOLD_PAGES; page += 1) {
    const result = await loadBookings('UPCOMING', page);
    if (result.kind !== 'ok') return null;
    const match = result.data.items.find(booking => booking.status === 'PENDING'
      && !!booking.holdExpiresAt && new Date(booking.holdExpiresAt) > now
      && booking.segments.length === segments.length
      && booking.segments.every((segment, index) => segment.flightId === segments[index].flightId && segment.cabinId === segments[index].cabinId));
    if (match) return match;
    if (page * result.data.pageSize >= result.data.total) return null;
  }
  return null;
}

/** Sends guests to sign in and back (ACC-10), and hides other travelers' bookings behind a 404 (ACC-11). */
export function settle<T>(result: Loaded<T>, returnTo: string): Settled<T> {
  if (result.kind === 'unauthenticated') redirect(loginHref(returnTo));
  if (result.kind === 'not-found') notFound();
  return result;
}
