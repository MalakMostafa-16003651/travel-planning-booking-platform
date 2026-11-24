import { formatMoneyMajorUnits } from '@/lib/format/money';
import type { BudgetCategory, ItineraryVisibility, TransportMode } from './types';

/** Formats a backend YYYY-MM-DD as a calendar date without any time-zone shift. */
export function formatDateOnly(value: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

export function formatDayDate(value: string): string {
  return formatDateOnly(value, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatDateRange(start: string, end?: string): string {
  if (!end || end === start) return formatDateOnly(start);
  return `${formatDateOnly(start)} – ${formatDateOnly(end)}`;
}

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export const visibilityLabels: Record<ItineraryVisibility, string> = { PRIVATE: 'Private', PUBLIC: 'Public' };

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}


export const categoryLabels: Record<BudgetCategory, string> = {
  FOOD: 'Food', ACCOMMODATION: 'Accommodation', ACTIVITIES: 'Activities', LOCAL_TRANSPORT: 'Local transport',
};

export const transportLabels: Record<TransportMode, string> = {
  FLIGHT: 'Flight', TRAIN: 'Train', BUS: 'Bus', CAR: 'Car', FERRY: 'Ferry', OTHER: 'Other',
};

/** Itinerary amounts are major units in their own currency (never cents). */
export function money(amount: number, currency: string): string {
  try {
    return formatMoneyMajorUnits(amount, currency);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Parses a typed amount: non-negative, at most two decimals (the backend's DTO rule). */
export function parseAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const amount = Number(trimmed);
  return Number.isFinite(amount) && amount <= 1_000_000_000 ? amount : null;
}
