import { Injectable } from '@nestjs/common';
import { BookingPaymentsPort, RefundRequest } from '../../flight-bookings/ports/booking-payments.port';
import { PaymentsService } from '../payments.service';
import { RefundsService } from '../refunds.service';

/**
 * Person 4's BOOKING_PAYMENTS port, implemented by Payments. Person 4 binds it in
 * FlightBookingsModule in place of PendingPaymentsAdapter (see the PR description).
 */
@Injectable()
export class BookingPaymentsAdapter implements BookingPaymentsPort {
  constructor(private readonly payments: PaymentsService, private readonly refunds: RefundsService) {}

  /** PAY-01: called when a hold expires. */
  cancelPendingPayment({ bookingId }: { bookingType: 'FLIGHT'; bookingId: string }): Promise<void> {
    return this.payments.cancelPendingPayment('flight', bookingId);
  }

  /** PAY-03: called after a cancellation with a positive refund. The flight module sends minor units. */
  async createRefund({ bookingId, amount, reason }: RefundRequest): Promise<{ refundId: string }> {
    const refund = await this.refunds.refundCancelledBooking({ bookingType: 'flight', bookingId, amount: amount / 100, reason });
    return { refundId: refund._id.toString() };
  }
}
