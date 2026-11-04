import { randomInt } from 'node:crypto';
import { CancellationTier } from './ports/flight-inventory.port';
import { PassengerType } from './schemas/flight-booking.schema';

export const BOOKING_HOLD_MS = 10 * 60 * 1000; // FLT-22
export const INFANT_FARE_PERCENTAGE = 10; // FLT-12
export const PLATFORM_CURRENCY = 'USD'; // PAY-04
export const BOOKINGS_PAGE_SIZE = 10; // GEN-05

const DAY_MS = 24 * 60 * 60 * 1000;
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No 0/O or 1/I.
const REFERENCE_LENGTH = 8;

function ageOn(dateOfBirth: Date, date: Date): number {
  const hadBirthday =
    date.getUTCMonth() > dateOfBirth.getUTCMonth() ||
    (date.getUTCMonth() === dateOfBirth.getUTCMonth() && date.getUTCDate() >= dateOfBirth.getUTCDate());
  return date.getUTCFullYear() - dateOfBirth.getUTCFullYear() - (hadBirthday ? 0 : 1);
}

/** FLT-12 bands, judged on the outbound departure date. Null if not yet born. */
export function passengerTypeOn(dateOfBirth: Date, departure: Date): PassengerType | null {
  if (dateOfBirth > departure) return null;
  const age = ageOn(dateOfBirth, departure);
  if (age >= 12) return PassengerType.ADULT;
  return age >= 2 ? PassengerType.CHILD : PassengerType.INFANT;
}

export function passengerFare(cabinFare: number, type: PassengerType): number {
  return type === PassengerType.INFANT ? Math.round(cabinFare * INFANT_FARE_PERCENTAGE / 100) : cabinFare;
}

/** Whole 24-hour periods remaining, rounded down. */
export function wholeDaysBefore(departure: Date, now: Date): number {
  return Math.floor((departure.getTime() - now.getTime()) / DAY_MS);
}

/** FLT-09: the tier with the highest threshold not exceeding the days remaining, else 0%. */
export function refundPercentageFor(tiers: CancellationTier[], daysRemaining: number): number {
  const applicable = tiers.filter((tier) => tier.daysBeforeDeparture <= daysRemaining);
  if (applicable.length === 0) return 0;
  return applicable.reduce((best, tier) => tier.daysBeforeDeparture > best.daysBeforeDeparture ? tier : best).refundPercentage;
}

export function refundAmountFor(totalAmount: number, percentage: number): number {
  return Math.round(totalAmount * percentage / 100);
}

export function generateBookingReference(): string {
  return Array.from({ length: REFERENCE_LENGTH }, () => REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)]).join('');
}
