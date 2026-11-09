import { Injectable } from '@nestjs/common';
import { BookingPaymentsPort } from '../../flight-bookings/ports/booking-payments.port';
import { BookingType } from '../bookings-port';
import { toMinorUnits } from '../money';
import { RefundStatus } from '../payment-status.enum';
import { PaymentsService } from '../payments.service';
import { RefundsService } from '../refunds.service';

/** The booking modules name their type in capitals: Person 4 sends 'FLIGHT', Person 6 sends 'HOTEL'. */
export type BookingModuleType = 'FLIGHT' | 'HOTEL';

export interface BookingRefundRequest {
  bookingType: BookingModuleType;
  bookingId: string;
  amount: number; // Minor units, as the booking modules store them.
  reason: string;
}

/** PAY-03: what a booking details page shows about its refund. Amount in minor units. */
export interface BookingRefundStatus {
  refundId: string;
  status: RefundStatus;
  amount: number;
  currency: string;
}

function toBookingType(type: BookingModuleType): BookingType {
  return type === 'FLIGHT' ? 'flight' : 'hotel';
}

/**
 * What the booking modules call on Payments. Person 4 binds it as BOOKING_PAYMENTS in
 * FlightBookingsModule; Person 6 binds it the same way in HotelBookingsModule.
 */
@Injectable()
export class BookingPaymentsAdapter implements BookingPaymentsPort {
  constructor(private readonly payments: PaymentsService, private readonly refunds: RefundsService) {}

  /**
   * PAY-01: called when a hold expires. Cancels the open PaymentIntent so it can no longer be paid.
   * Succeeds when there is no payment. If Stripe already took the money, it is refunded in full.
   */
  cancelPendingPayment({ bookingType, bookingId }: { bookingType: BookingModuleType; bookingId: string }): Promise<void> {
    return this.payments.cancelPendingPayment(toBookingType(bookingType), bookingId);
  }

  /**
   * PAY-03: called after a cancellation with a positive refund. Idempotent per booking and reason,
   * so a failed request can be retried safely.
   */
  async createRefund({ bookingType, bookingId, amount, reason }: BookingRefundRequest): Promise<{ refundId: string }> {
    const refund = await this.refunds.refundCancelledBooking({ bookingType: toBookingType(bookingType), bookingId, amount: amount / 100, reason });
    return { refundId: refund._id.toString() };
  }

  /**
   * PAY-03 "status on the booking details": the authoritative status of the booking's latest refund,
   * checked with Stripe while PENDING. Null when the booking has no refund.
   */
  async getRefundStatus({ bookingType, bookingId }: { bookingType: BookingModuleType; bookingId: string }): Promise<BookingRefundStatus | null> {
    const refund = await this.refunds.findLatestForBooking(toBookingType(bookingType), bookingId);
    if (!refund) return null;
    return { refundId: refund._id.toString(), status: refund.status, amount: toMinorUnits(refund.amount), currency: refund.currency };
  }
}
