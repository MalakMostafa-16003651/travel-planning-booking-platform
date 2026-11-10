import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingPaymentsAdapter } from '../payments/adapters/booking-payments.adapter';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { MongoFlightInventoryAdapter } from './adapters/mongo-flight-inventory.adapter';
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
    UsersModule,
    // Person 2's in-app notifications (GEN-01).
    NotificationsModule,
    // forwardRef: Payments also imports this module to confirm paid bookings.
    forwardRef(() => PaymentsModule),
    MongooseModule.forFeature([{ name: FlightBooking.name, schema: FlightBookingSchema }]),
  ],
  controllers: [FlightBookingsController],
  providers: [
    FlightBookingsService,
    FlightBookingsMaintenanceService,
    ETicketService,
    { provide: FLIGHT_INVENTORY, useClass: MongoFlightInventoryAdapter },
    // Person 8's adapter: hold expiry, refunds and refund status (PAY-01, PAY-03).
    { provide: BOOKING_PAYMENTS, useExisting: BookingPaymentsAdapter },
    // NotificationsService.notify takes the same { userId, type, message } input.
    { provide: BOOKING_NOTIFICATIONS, useExisting: NotificationsService },
  ],
  exports: [FlightBookingsService],
})
export class FlightBookingsModule {}
