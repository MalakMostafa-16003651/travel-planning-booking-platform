import { Injectable } from '@nestjs/common';

/**
 * Agreed with Person 5 on 2026-11-08 (contract question L2): "today" is the server's current UTC
 * calendar date, and stay dates are compared with it as YYYY-MM-DD strings. No client-local time.
 * Used for check-in not in the past (HTL-18), before check-in (HTL-21), Upcoming/Past (HTL-20),
 * completion (GEN-11, HTL-23) and upcoming reservations (ACC-12).
 */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The module's only source of "today". Injected so tests can pin a fixed date instead of the real
 * clock (no flakiness around UTC midnight); production always uses todayUtc().
 */
@Injectable()
export class HotelBookingsClock {
  today(): string {
    return todayUtc();
  }
}
