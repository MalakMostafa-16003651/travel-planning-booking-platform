import 'server-only';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { loginHref } from '@/config/routes';
import { authCookies, backendUrl } from '@/lib/api/upstream';
import { bookingReadPath, toBookingState, type BookingState } from './outcome';
import type {
  BookingPolicies, CheckoutSummary, CheckoutType, FlightBookingSummary, FlightChangeSummary, FlightSegmentSummary,
  HotelBookingSummary, Payment,
} from './types';

// Server Component reads for checkout, with the traveler's own cookies (the same pattern as
// features/flight-bookings/server.ts). Never cached: amounts, holds and statuses change by the second.

const TIMEOUT_MS = 15_000;

export type Loaded<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'unauthenticated' }
  | { kind: 'forbidden' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

async function loadPrivate<T>(path: string): Promise<Loaded<T>> {
  const jar = await cookies();
  let response: Response;
  try {
    response = await fetch(new URL(`/api${path}`, backendUrl()), {
      headers: { Cookie: authCookies(jar.toString()) }, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: 'error', message: 'The payment service is not responding. Please try again.' };
  }
  if (response.status === 401) return { kind: 'unauthenticated' };
  if (response.status === 403) return { kind: 'forbidden' };
  // 400 only happens for a malformed id, which is "not found" for the traveler as well.
  if (response.status === 404 || response.status === 400) return { kind: 'not-found' };
  if (!response.ok) return { kind: 'error', message: 'Checkout could not be loaded. Please try again.' };
  return { kind: 'ok', data: await response.json() as T };
}

/** The first problem wins, in the order a page has to handle them. */
function combine<A, B>(a: Loaded<A>, b: Loaded<B>): Loaded<[A, B]> {
  for (const kind of ['unauthenticated', 'forbidden', 'not-found', 'error'] as const) {
    if (a.kind === kind) return a;
    if (b.kind === kind) return b;
  }
  return { kind: 'ok', data: [(a as { data: A }).data, (b as { data: B }).data] };
}

/** Sends guests to sign in and back (ACC-10); another traveler's booking is a plain 404 (ACC-11). */
export function settle<T>(result: Loaded<T>, returnTo: string): Exclude<Loaded<T>, { kind: 'unauthenticated' | 'not-found' }> {
  if (result.kind === 'unauthenticated') redirect(loginHref(returnTo));
  if (result.kind === 'not-found') notFound();
  return result;
}

// GEN-06: a flight time is shown in its own airport's zone.
function departure(segment: FlightSegmentSummary): string {
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: segment.departureTimeZone, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(segment.departureAt));
  return `${segment.departureAirportCode} to ${segment.arrivalAirportCode} · ${segment.flightNumber} · ${when}`;
}

function airlineLabels(segments: FlightSegmentSummary[]): Record<string, string> {
  const labels: Record<string, string[]> = {};
  for (const segment of segments) (labels[String(segment.airlineId)] ??= []).push(segment.flightNumber);
  return Object.fromEntries(Object.entries(labels).map(([id, numbers]) => [id, `Airline of ${numbers.join(' and ')}`]));
}

// Hotel dates are date-only (YYYY-MM-DD); formatting them in UTC keeps the calendar day unchanged.
function calendarDay(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00Z`));
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function flightSummary(booking: FlightBookingSummary): CheckoutSummary {
  return {
    status: booking.status,
    holdExpiresAt: booking.holdExpiresAt,
    title: 'Flight booking',
    details: [...booking.segments.map(departure), plural(booking.passengers.length, 'traveler')],
    airlineLabels: airlineLabels(booking.segments),
  };
}

function hotelSummary(booking: HotelBookingSummary): CheckoutSummary {
  return {
    status: booking.status,
    holdExpiresAt: booking.holdExpiresAt,
    title: booking.hotelName,
    details: [
      `${calendarDay(booking.checkIn)} to ${calendarDay(booking.checkOut)} · ${plural(booking.nights, 'night')}`,
      `${plural(booking.rooms.length, 'room')} · ${plural(booking.guestCount, 'guest')}`,
    ],
    airlineLabels: {},
  };
}

function changeSummary(change: FlightChangeSummary): CheckoutSummary {
  return {
    status: change.status,
    holdExpiresAt: change.holdExpiresAt,
    title: 'Fare difference for your flight change',
    details: change.segments.map(segment => `New flight: ${departure(segment)}`),
    airlineLabels: airlineLabels(change.segments),
    flightBookingId: change.flightBookingId,
  };
}

async function loadSummary(type: CheckoutType, id: string): Promise<Loaded<CheckoutSummary>> {
  const path = encodeURIComponent(id);
  const result = type === 'flight' ? await loadPrivate<FlightBookingSummary>(`/flight-bookings/${path}`)
    : type === 'hotel' ? await loadPrivate<HotelBookingSummary>(`/hotel-bookings/${path}`)
      : await loadPrivate<FlightChangeSummary>(`/flight-booking-changes/${path}`);
  if (result.kind !== 'ok') return result;
  const data = result.data;
  const summary = type === 'flight' ? flightSummary(data as FlightBookingSummary)
    : type === 'hotel' ? hotelSummary(data as HotelBookingSummary)
      : changeSummary(data as FlightChangeSummary);
  return { kind: 'ok', data: summary };
}

/** Policies and amount (Payments) plus status and hold expiry (the booking module), read together. */
export async function loadCheckout(type: CheckoutType, id: string): Promise<Loaded<{ policies: BookingPolicies; summary: CheckoutSummary }>> {
  const [policies, summary] = await Promise.all([
    loadPrivate<BookingPolicies>(`/bookings/${type}/${encodeURIComponent(id)}/policies`),
    loadSummary(type, id),
  ]);
  const both = combine(policies, summary);
  return both.kind === 'ok' ? { kind: 'ok', data: { policies: both.data[0], summary: both.data[1] } } : both;
}

export function loadPayment(id: string): Promise<Loaded<Payment>> {
  return loadPrivate(`/payments/${encodeURIComponent(id)}`);
}

/** Status, hold and refund of the booking (or change) a payment is for; a change also names its booking. */
export async function loadBookingState(type: CheckoutType, id: string): Promise<Loaded<{ state: BookingState; flightBookingId?: string }>> {
  const result = await loadPrivate<Parameters<typeof toBookingState>[0] & { flightBookingId?: string }>(bookingReadPath(type, id));
  if (result.kind !== 'ok') return result;
  return { kind: 'ok', data: { state: toBookingState(result.data), flightBookingId: type === 'flight-change' ? result.data.flightBookingId : undefined } };
}
