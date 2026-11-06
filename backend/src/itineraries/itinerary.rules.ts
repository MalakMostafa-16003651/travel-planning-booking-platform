/**
 * Business rules for itinerary planning (ITN-*). Limits marked "assumed" are not fixed by
 * the project PDF; confirm them against the reviewed requirements workbook.
 */

export enum ItineraryVisibility {
  PRIVATE = 'PRIVATE',
  PUBLIC = 'PUBLIC',
}

/** ITN-14: the four daily budget categories. Intercity transport is a separate TransportCost. */
export enum BudgetCategory {
  FOOD = 'FOOD',
  ACCOMMODATION = 'ACCOMMODATION',
  ACTIVITIES = 'ACTIVITIES',
  LOCAL_TRANSPORT = 'LOCAL_TRANSPORT',
}

/** ITN-16: how travellers move between cities. */
export enum TransportMode {
  FLIGHT = 'FLIGHT',
  TRAIN = 'TRAIN',
  BUS = 'BUS',
  CAR = 'CAR',
  FERRY = 'FERRY',
  OTHER = 'OTHER',
}

export const ITINERARY_PAGE_SIZE = 10; // GEN-05, same as flight bookings
export const MAX_DAYS = 60; // ITN-05
export const MAX_ACTIVITIES_PER_DAY = 30; // assumed
export const MAX_BUDGETS_PER_DAY = 50; // assumed
export const MAX_TRANSPORT_COSTS = 100; // assumed
export const MAX_IMAGES_PER_ACTIVITY = 5; // assumed
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // assumed, GEN-08
export const MAX_AMOUNT = 1_000_000_000;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Parses a YYYY-MM-DD string as a UTC calendar date. */
export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** ITN-05/ITN-08: day N falls N-1 days after the start date. Dates are never stored per day. */
export function dateOfDay(startDate: Date, dayNumber: number): Date {
  return new Date(startDate.getTime() + (dayNumber - 1) * DAY_MS);
}

/** Rounds to two decimal places without binary drift (e.g. 1.005 -> 1.01). */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface CityGroup {
  city: string;
  countryCode?: string;
  firstDayNumber: number;
  lastDayNumber: number;
  startDate: string;
  endDate: string;
  dayCount: number;
  dayIds: string[];
}

/**
 * Consecutive days in the same city form one stop. Recomputed from the current day
 * order on every read, so add/delete/reorder can never leave stale grouping behind.
 */
export function groupDaysByCity(
  startDate: Date,
  days: { dayId: string; city: string; countryCode?: string }[],
): CityGroup[] {
  const groups: CityGroup[] = [];
  days.forEach((day, index) => {
    const dayNumber = index + 1;
    const date = formatDateOnly(dateOfDay(startDate, dayNumber));
    const last = groups.at(-1);
    if (last && sameCity(last, day)) {
      last.lastDayNumber = dayNumber;
      last.endDate = date;
      last.dayCount += 1;
      last.dayIds.push(day.dayId);
    } else {
      groups.push({
        city: day.city,
        ...(day.countryCode ? { countryCode: day.countryCode } : {}),
        firstDayNumber: dayNumber,
        lastDayNumber: dayNumber,
        startDate: date,
        endDate: date,
        dayCount: 1,
        dayIds: [day.dayId],
      });
    }
  });
  return groups;
}

function sameCity(group: { city: string; countryCode?: string }, day: { city: string; countryCode?: string }): boolean {
  return group.city.toLowerCase() === day.city.toLowerCase()
    && (group.countryCode ?? '') === (day.countryCode ?? '');
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
