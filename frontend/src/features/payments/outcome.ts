import { effectiveStatus, type BookingStatus } from '@/components/booking/booking-status';
import type { CheckoutType, Payment } from './types';

// What the result page tells the traveler, decided from TWO backend reads: the payment AND the booking.
// A SUCCEEDED payment alone is not a confirmed booking: when the hold ended before Stripe's success
// arrived, the backend keeps the booking unconfirmed and refunds the full amount (payments.service.ts,
// finishSucceededPayment). So "confirmed" needs the booking itself to be CONFIRMED or COMPLETED.

/** failureReason values set by the backend (payments.service.ts). */
export const AMOUNT_MISMATCH_REASON = 'Paid amount does not match the booking amount';
export const HOLD_EXPIRED_REASON = 'The booking hold expired before the payment succeeded';

/** The booking fields the result page needs, the same for flights, hotels and changes. */
export interface BookingState {
  status: BookingStatus;
  holdExpiresAt?: string;
  refundId?: string;
}

/** GET path of the booking (or change) a payment is for. */
export function bookingReadPath(type: CheckoutType, bookingId: string): string {
  const id = encodeURIComponent(bookingId);
  if (type === 'flight') return `/flight-bookings/${id}`;
  if (type === 'hotel') return `/hotel-bookings/${id}`;
  return `/flight-booking-changes/${id}`;
}

/** Reads BookingState from any of the three booking responses (field names from their DTOs). */
export function toBookingState(raw: { status: BookingStatus; holdExpiresAt?: string; refundId?: string; refund?: { refundId?: string } }): BookingState {
  return { status: raw.status, holdExpiresAt: raw.holdExpiresAt, refundId: raw.refundId ?? raw.refund?.refundId };
}

export type Outcome =
  /** Booking confirmed by the backend. The only success. */
  | 'confirmed'
  /** Still waiting for Stripe or for the booking to be confirmed. */
  | 'waiting'
  /** A normal decline: the traveler can retry while the hold lasts. */
  | 'failed'
  /** Stripe's amount did not match: an admin checks it, no retry. */
  | 'review'
  /** The hold ended (or the booking was cancelled) before the payment completed. */
  | 'ended';

/**
 * `now` is the server's clock (the client adds the offset measured at render), so a wrong device clock
 * cannot decide that a hold ended.
 */
export function paymentOutcome(payment: Payment, booking: BookingState | null, now: string): Outcome {
  const status = booking ? effectiveStatus(booking.status, booking.holdExpiresAt, now) : null;
  if (status === 'CONFIRMED' || status === 'COMPLETED') return 'confirmed';
  const bookingOver = status === 'EXPIRED' || status === 'CANCELLED';
  if (payment.status === 'FAILED') {
    if (payment.failureReason === AMOUNT_MISMATCH_REASON) return 'review';
    return bookingOver || payment.failureReason === HOLD_EXPIRED_REASON ? 'ended' : 'failed';
  }
  if (payment.status === 'REFUNDED') return 'ended';
  // SUCCEEDED or PENDING: over only if the booking is; otherwise the confirmation is still on its way.
  return bookingOver ? 'ended' : 'waiting';
}
