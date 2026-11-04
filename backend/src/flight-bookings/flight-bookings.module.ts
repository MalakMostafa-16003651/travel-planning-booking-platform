import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { MongoFlightInventoryAdapter } from './adapters/mongo-flight-inventory.adapter';
import { PendingNotificationsAdapter, PendingPaymentsAdapter } from './adapters/pending-integration.adapters';
import { ETicketService } from './e-ticket.service';
import { FlightBookingsMaintenanceService } from './flight-bookings-maintenance.service';
import { FlightBookingsController } from './flight-bookings.controller';
import { FlightBookingsService } from './flight-bookings.service';
import { BOOKING_NOTIFICATIONS } from './ports/booking-notifications.port';
import { BOOKING_PAYMENTS } from './ports/booking-payments.port';
import { FLIGHT_INVENTORY } from './ports/flight-inventory.port';
import { FlightBooking, FlightBookingSchema } from './schemas/flight-booking.schema';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([{ name: FlightBooking.name, schema: FlightBookingSchema }]),
  ],
  controllers: [FlightBookingsController],
  providers: [
    FlightBookingsService,
    FlightBookingsMaintenanceService,
    ETicketService,
    { provide: FLIGHT_INVENTORY, useClass: MongoFlightInventoryAdapter },
    { provide: BOOKING_PAYMENTS, useClass: PendingPaymentsAdapter },
    { provide: BOOKING_NOTIFICATIONS, useClass: PendingNotificationsAdapter },
  ],
  exports: [FlightBookingsService],
})
export class FlightBookingsModule {}
