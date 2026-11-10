import { BadRequestException } from '@nestjs/common';
import { todayUtc } from '../hotel-bookings/hotel-booking.dates';

/** Shared by public search and available-room lookup, including direct itinerary calls. */
export function assertSearchStay(checkIn: string, checkOut: string): void {
  const real = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  const errors: Record<string, string[]> = {};
  if (!real(checkIn)) errors.checkIn = ['checkIn must be a real calendar date'];
  if (!real(checkOut)) errors.checkOut = ['checkOut must be a real calendar date'];
  if (!errors.checkIn && checkIn < todayUtc()) errors.checkIn = ['checkIn must not be in the past'];
  if (!errors.checkIn && !errors.checkOut && checkIn >= checkOut) errors.checkOut = ['checkIn must be before checkOut'];
  if (Object.keys(errors).length) throw new BadRequestException({ message: 'Validation failed', errors });
}
