import { formatMoneyMinorUnits } from '@/lib/format/money';
import type { CancellationTier, PassengerType } from './types';

// GEN-06: every flight time is shown in the zone of the airport it happens at (Person 3's formatters).
export { cabinLabel as cabinName, formatAirportClock as localClock, formatAirportDate as localDay, zoneLabel as zoneName } from '@/lib/flights/format';

const passengers: Record<PassengerType, string> = { ADULT: 'Adult', CHILD: 'Child', INFANT: 'Infant' };

export function passengerTypeName(type: PassengerType): string {
  return passengers[type] ?? type;
}

export function money(minorUnits: number, currency = 'USD'): string {
  return formatMoneyMinorUnits(minorUnits, currency);
}

/** YYYY-MM-DD on the airport's own calendar, for date inputs and flight search. */
export function localIsoDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export function duration(fromIso: string, toIso: string): string {
  const minutes = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000));
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** Date of birth is a plain calendar date, so it is never moved into a local time zone. */
export function calendarDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso));
}

export function daysUntil(iso: string, nowIso: string): string {
  const hours = (new Date(iso).getTime() - new Date(nowIso).getTime()) / 3_600_000;
  if (hours <= 0) return 'Departed';
  if (hours < 1) return 'Departs within the hour';
  if (hours < 24) {
    const whole = Math.floor(hours);
    return `Departs in ${whole} ${whole === 1 ? 'hour' : 'hours'}`;
  }
  const days = Math.floor(hours / 24);
  return `Departs in ${days} ${days === 1 ? 'day' : 'days'}`;
}

export function maskDocument(documentNumber: string): string {
  return `${'•'.repeat(Math.max(documentNumber.length - 4, 0))}${documentNumber.slice(-4)}`;
}

export function count(amount: number, singular: string, plural = `${singular}s`): string {
  return `${amount} ${amount === 1 ? singular : plural}`;
}

/** Highest threshold first, which is also the order the backend applies them in (FLT-09). */
export function tierLines(tiers: CancellationTier[]): string[] {
  return [...tiers]
    .sort((a, b) => b.daysBeforeDeparture - a.daysBeforeDeparture)
    .map(({ daysBeforeDeparture, refundPercentage }) =>
      daysBeforeDeparture === 0
        ? `Any time before departure: ${refundPercentage}% back`
        : `${count(daysBeforeDeparture, 'day')} or more before departure: ${refundPercentage}% back`);
}
