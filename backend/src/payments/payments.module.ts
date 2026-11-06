import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { MongoFlightInventoryAdapter } from '../flight-bookings/adapters/mongo-flight-inventory.adapter';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { BookingPaymentsAdapter } from './adapters/booking-payments.adapter';
import { FlightBookingsAdapter } from './adapters/flight-bookings.adapter';
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
    // forwardRef: FlightBookingsModule will import this module for its BOOKING_PAYMENTS port.
    forwardRef(() => FlightBookingsModule),
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
    { provide: BOOKINGS_PORT, useClass: FlightBookingsAdapter },
    BookingPaymentsAdapter,
  ],
  // Person 4 binds BOOKING_PAYMENTS to this adapter.
  exports: [BookingPaymentsAdapter],
})
export class PaymentsModule {}
