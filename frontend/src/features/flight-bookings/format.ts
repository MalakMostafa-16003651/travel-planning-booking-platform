import { formatMoneyMinorUnits } from '@/lib/format/money';
import type { CabinClass, CancellationTier, PassengerType } from './types';

const cabins: Record<CabinClass, string> = {
  ECONOMY: 'Economy', PREMIUM_ECONOMY: 'Premium economy', BUSINESS: 'Business', FIRST: 'First',
};
const passengers: Record<PassengerType, string> = { ADULT: 'Adult', CHILD: 'Child', INFANT: 'Infant' };

export function cabinName(cabin: CabinClass): string {
  return cabins[cabin] ?? cabin;
}

export function passengerTypeName(type: PassengerType): string {
  return passengers[type] ?? type;
}

export function money(minorUnits: number, currency = 'USD'): string {
  return formatMoneyMinorUnits(minorUnits, currency);
}

// GEN-06: every flight time is shown in the zone of the airport it happens at.
export function localClock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

export function localDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(iso));
}

export function zoneName(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' })
    .formatToParts(new Date(iso)).find(part => part.type === 'timeZoneName')?.value ?? timeZone;
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
