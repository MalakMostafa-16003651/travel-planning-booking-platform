import type { ItineraryVisibility } from './types';

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
