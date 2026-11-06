import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { BookingPaymentsPort } from '../../flight-bookings/ports/booking-payments.port';
import { PaymentsService } from '../payments.service';

/**
 * Person 4's BOOKING_PAYMENTS port, implemented by Payments. Person 4 binds it in
 * FlightBookingsModule in place of PendingPaymentsAdapter (see the PR description).
 */
@Injectable()
export class BookingPaymentsAdapter implements BookingPaymentsPort {
  constructor(private readonly payments: PaymentsService) {}

  /** PAY-01: called when a hold expires. */
  cancelPendingPayment({ bookingId }: { bookingType: 'FLIGHT'; bookingId: string }): Promise<void> {
    return this.payments.cancelPendingPayment('flight', bookingId);
  }

  async createRefund(): Promise<{ refundId: string }> {
    // PAY-03 adds booking refunds. Throwing keeps refundDue set, so the booking module retries later.
    throw new ServiceUnavailableException('Refunds are not available yet');
  }
}
