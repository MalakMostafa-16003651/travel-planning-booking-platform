import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { MongoFlightInventoryAdapter } from '../flight-bookings/adapters/mongo-flight-inventory.adapter';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { FlightBookingsAdapter } from './adapters/flight-bookings.adapter';
import { BOOKINGS_PORT } from './bookings-port';
import { PoliciesController } from './policies.controller';
import { PoliciesService } from './policies.service';
import { PolicyAcceptance, PolicyAcceptanceSchema } from './schemas/policy-acceptance.schema';

@Module({
  imports: [
    AuthModule,
    // forwardRef: FlightBookingsModule will import this module for its BOOKING_PAYMENTS port.
    forwardRef(() => FlightBookingsModule),
    MongooseModule.forFeature([{ name: PolicyAcceptance.name, schema: PolicyAcceptanceSchema }]),
  ],
  controllers: [PoliciesController],
  providers: [
    PoliciesService,
    // Read-only use of Person 4's adapter for the airline policies of a booking.
    MongoFlightInventoryAdapter,
    { provide: BOOKINGS_PORT, useClass: FlightBookingsAdapter },
  ],
})
export class PaymentsModule {}
