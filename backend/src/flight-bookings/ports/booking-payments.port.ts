export const BOOKING_PAYMENTS = 'BOOKING_PAYMENTS';

export interface RefundRequest {
  bookingType: 'FLIGHT';
  bookingId: string;
  amount: number;
  reason: string;
}

/** PAY-03 values from the workbook: Pending, Refunded, Failed. */
export type RefundState = 'PENDING' | 'REFUNDED' | 'FAILED';

export interface BookingRefundStatus {
  refundId: string;
  status: RefundState;
  amount: number; // Minor units.
  currency: string;
}

/** Everything flight booking needs from the Payments module (Person 8), bound to its BookingPaymentsAdapter. */
export interface BookingPaymentsPort {
  /** PAY-01: cancels any open PaymentIntent. Succeeds when there is none; a payment already taken is refunded. */
  cancelPendingPayment(request: { bookingType: 'FLIGHT' | 'FLIGHT_CHANGE'; bookingId: string }): Promise<void>;
  getChangeRefundStatus?(id: string, bookingId: string): Promise<BookingRefundStatus | null>;
  hasAcceptedChangePolicies?(id: string, userId: string, policies: unknown): Promise<boolean>;
  /** PAY-03: idempotent per booking and reason, because failed requests are retried. */
  createRefund(request: RefundRequest): Promise<{ refundId: string; status?: RefundState }>;
  /** PAY-03: the authoritative status of the booking's latest refund, or null when it has none. */
  getRefundStatus(request: { bookingType: 'FLIGHT'; bookingId: string }): Promise<BookingRefundStatus | null>;
}
