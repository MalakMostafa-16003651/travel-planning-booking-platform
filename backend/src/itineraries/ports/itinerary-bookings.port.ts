import { BookingStatus } from '../../common/enums/booking-status.enum';

export const ITINERARY_FLIGHT_BOOKINGS = 'ITINERARY_FLIGHT_BOOKINGS';
export const ITINERARY_HOTEL_BOOKINGS = 'ITINERARY_HOTEL_BOOKINGS';

/**
 * ITN-27 (bonus): what the itinerary reads about one of the user's own bookings. Adapters map
 * the booking modules' documents onto this shape, so the itinerary never depends on their
 * schemas directly.
 */
export interface LinkableBooking {
  status: BookingStatus;
  /** Integer minor units of `currency` (PAY-04: USD cents). */
  amountMinor: number;
  currency: string;
  /** Present once the booking is CONFIRMED. */
  bookingReference?: string;
  /** Hotel name, or the flight numbers. */
  label: string;
  /** YYYY-MM-DD. Hotel: check-in. Flight: local departure date of the first segment. */
  startDate: string;
  /** YYYY-MM-DD, exclusive. Hotel: check-out (the departure day). Absent for flights. */
  endDate?: string;
}

/**
 * Owner-only lookup. Must throw NotFoundException when the booking does not exist or belongs
 * to another user (ACC-11). Any other error propagates.
 */
export interface ItineraryBookingsPort {
  getOwnBooking(bookingId: string, userId: string): Promise<LinkableBooking>;
}
