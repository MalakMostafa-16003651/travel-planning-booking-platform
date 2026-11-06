import { BookingStatus } from '../common/enums/booking-status.enum';

export type BookingType = 'flight' | 'hotel';

/** What Payments reads from a FlightBooking (Person 4) or HotelBooking (Person 6). */
export interface PayableBooking {
  bookingId: string;
  userId: string;
  status: BookingStatus;
  totalPrice: number; // Major units, e.g. 150.5. The booking modules store minor units.
  currency: string;
  /** The provider policies the user accepts before paying (PAY-02). */
  policies: { cancellation: unknown; baggage?: unknown; checkInOut?: unknown };
  holdExpiresAt?: Date;
}

/** The only things Payments needs from the booking modules. */
export interface BookingsPort {
  /** Null when the booking does not exist or belongs to another user. */
  getBooking(type: BookingType, bookingId: string, userId: string): Promise<PayableBooking | null>;
  /** True only if the booking is now CONFIRMED by this payment. Safe to repeat. */
  markConfirmed(type: BookingType, bookingId: string, paymentId: string): Promise<boolean>;
  /** The booking stays PENDING so the user can retry before the hold ends. */
  markPaymentFailed(type: BookingType, bookingId: string, paymentId: string): Promise<void>;
}

export const BOOKINGS_PORT = 'PAYMENTS_BOOKINGS_PORT';
