// Hotel stays are date-only (YYYY-MM-DD, checkout exclusive). Never round-trip a value
// through `new Date(value)` for display or arithmetic: that parses as UTC midnight, and
// formatting it back in the browser's local zone can shift the calendar day by one.
// Arithmetic here uses Date.UTC/getUTC* explicitly so it never depends on the caller's
// local offset; only `todayDateOnly` deliberately reads the *local* calendar day, since
// "check-in cannot be in the past" means the guest's own today, not UTC's.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function todayDateOnly(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function compareDateOnly(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addDaysToDateOnly(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Whole nights between an inclusive check-in and exclusive check-out. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const [y1, m1, d1] = checkIn.split("-").map(Number);
  const [y2, m2, d2] = checkOut.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export interface StayDates {
  checkIn: string;
  checkOut: string;
}

/** HTL-11: check-out must be after check-in, and check-in cannot be in the past. */
export function stayDatesError(dates: StayDates): string | null {
  if (!dates.checkIn || !dates.checkOut) return null;
  if (compareDateOnly(dates.checkIn, todayDateOnly()) < 0) return "Check-in cannot be in the past.";
  if (compareDateOnly(dates.checkOut, dates.checkIn) <= 0) return "Check-out must be after check-in.";
  return null;
}
