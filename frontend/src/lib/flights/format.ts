import { formatMoneyMinorUnits } from '@/lib/format/money';
import type { CabinClass, Flight, FlightCabin, SearchCriteria } from './types';

const CABIN_LABELS: Record<CabinClass, string> = {
  ECONOMY: 'Economy',
  PREMIUM_ECONOMY: 'Premium economy',
  BUSINESS: 'Business',
  FIRST: 'First',
};

export function cabinLabel(cabin: CabinClass): string {
  return CABIN_LABELS[cabin] ?? cabin;
}

/** GEN-06: show a UTC instant in the time zone of the airport it belongs to. */
export function formatAirportTime(utcIso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(utcIso));
}

export function formatAirportClock(utcIso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(utcIso));
}

export function formatAirportDate(utcIso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(utcIso));
}

/** Short zone name such as "GMT+2", so users see which clock they are reading. */
export function zoneLabel(utcIso: string, timeZone: string): string {
  const part = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' }).formatToParts(new Date(utcIso)).find(p => p.type === 'timeZoneName');
  return part?.value ?? timeZone;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function cheapestCabin(flight: Flight): FlightCabin | undefined {
  return [...flight.cabins].sort((a, b) => a.price - b.price)[0];
}

export function formatPrice(minor: number): string {
  return formatMoneyMinorUnits(minor, 'USD');
}

/** Whole dollars typed by the user -> cents for the API. Returns undefined when empty or invalid. */
export function dollarsToMinor(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
}

export function criteriaToParams(c: Partial<SearchCriteria>): URLSearchParams {
  const p = new URLSearchParams();
  if (c.departureAirportCode) p.set('departureAirportCode', c.departureAirportCode);
  if (c.arrivalAirportCode) p.set('arrivalAirportCode', c.arrivalAirportCode);
  if (c.departureDate) p.set('departureDate', c.departureDate);
  if (c.roundTrip) {
    p.set('roundTrip', 'true');
    if (c.returnDate) p.set('returnDate', c.returnDate);
  }
  p.set('adults', String(c.adults ?? 1));
  if (c.children) p.set('children', String(c.children));
  if (c.infants) p.set('infants', String(c.infants));
  if (c.cabinClass) p.set('cabinClass', c.cabinClass);
  return p;
}

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const num = (v: string | string[] | undefined, fallback: number) => {
  const n = Number(first(v));
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

export function paramsToCriteria(raw: Raw): Partial<SearchCriteria> {
  const cabin = first(raw.cabinClass);
  return {
    departureAirportCode: first(raw.departureAirportCode)?.toUpperCase() ?? '',
    arrivalAirportCode: first(raw.arrivalAirportCode)?.toUpperCase() ?? '',
    departureDate: first(raw.departureDate) ?? '',
    roundTrip: first(raw.roundTrip) === 'true',
    returnDate: first(raw.returnDate) ?? '',
    adults: Math.max(1, num(raw.adults, 1)),
    children: num(raw.children, 0),
    infants: num(raw.infants, 0),
    cabinClass: ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'].includes(cabin ?? '') ? (cabin as SearchCriteria['cabinClass']) : undefined,
  };
}
