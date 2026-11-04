export const BOOKING_PAYMENTS = 'BOOKING_PAYMENTS';

export interface RefundRequest {
  bookingType: 'FLIGHT';
  bookingId: string;
  amount: number;
  reason: string;
}

/** Everything flight booking needs from the Payments module (Person 8). */
export interface BookingPaymentsPort {
  /** PAY-01: cancels any open PaymentIntent. Must succeed when there is none. */
  cancelPendingPayment(request: { bookingType: 'FLIGHT'; bookingId: string }): Promise<void>;
  /** PAY-03: must be idempotent per booking, because failed requests are retried. */
  createRefund(request: RefundRequest): Promise<{ refundId: string }>;
}
