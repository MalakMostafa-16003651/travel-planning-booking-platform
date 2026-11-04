import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { BookingNotification, BookingNotificationsPort } from '../ports/booking-notifications.port';
import { BookingPaymentsPort } from '../ports/booking-payments.port';

/**
 * Temporary bindings until the Payments and Notifications modules exist. Replace them
 * in FlightBookingsModule; nothing else in this module changes.
 */
@Injectable()
export class PendingPaymentsAdapter implements BookingPaymentsPort {
  async cancelPendingPayment(): Promise<void> {
    // With no Payments module, no PaymentIntent can exist.
  }

  async createRefund(): Promise<{ refundId: string }> {
    // Keeps refundDue set, so the refund is retried once Payments is connected.
    throw new ServiceUnavailableException('Refunds are not available yet');
  }
}

@Injectable()
export class PendingNotificationsAdapter implements BookingNotificationsPort {
  private readonly logger = new Logger(PendingNotificationsAdapter.name);

  async notify(notification: BookingNotification): Promise<void> {
    // Logs the type only: messages contain booking details.
    this.logger.debug(`Notification not delivered: ${notification.type}`);
  }
}
