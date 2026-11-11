import { FlightBookingChangesPersistenceModule } from '../flight-bookings/flight-booking-changes-persistence.module';
import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { MongoFlightInventoryAdapter } from '../flight-bookings/adapters/mongo-flight-inventory.adapter';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingPaymentsAdapter } from './adapters/booking-payments.adapter';
import { BookingsAdapter } from './adapters/bookings.adapter';
import { BOOKINGS_PORT } from './bookings-port';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PoliciesController } from './policies.controller';
import { PoliciesService } from './policies.service';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { PolicyAcceptance, PolicyAcceptanceSchema } from './schemas/policy-acceptance.schema';
import { Refund, RefundSchema } from './schemas/refund.schema';
import { StripeService } from './stripe.service';

@Module({
  imports: [
    AuthModule,
    FlightBookingChangesPersistenceModule,
    // forwardRef: the booking modules import this module for their BOOKING_PAYMENTS port.
    forwardRef(() => FlightBookingsModule),
    forwardRef(() => HotelBookingsModule),
    // Person 2's in-app notifications (GEN-01), used for refunds (PAY-03).
    NotificationsModule,
    MongooseModule.forFeature([
      { name: PolicyAcceptance.name, schema: PolicyAcceptanceSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
    ]),
  ],
  controllers: [PoliciesController, PaymentsController, RefundsController],
  providers: [
    PoliciesService,
    PaymentsService,
    RefundsService,
    StripeService,
    // Read-only use of Person 4's adapter for the airline policies of a booking.
    MongoFlightInventoryAdapter,
    { provide: BOOKINGS_PORT, useClass: BookingsAdapter },
    BookingPaymentsAdapter,
  ],
  // Persons 4 and 6 bind their BOOKING_PAYMENTS port to this adapter.
  exports: [BookingPaymentsAdapter],
})
export class PaymentsModule {}
