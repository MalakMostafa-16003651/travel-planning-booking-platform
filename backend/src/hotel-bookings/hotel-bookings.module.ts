import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { HotelBookingsMaintenanceService } from './hotel-bookings-maintenance.service';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelBookingsService } from './hotel-bookings.service';
import { HotelBooking, HotelBookingSchema } from './schemas/hotel-booking.schema';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([{ name: HotelBooking.name, schema: HotelBookingSchema }]),
  ],
  controllers: [HotelBookingsController],
  providers: [HotelBookingsService, HotelBookingsMaintenanceService],
  // Person 5 (HTL-22 listForHotel), Person 2 (ACC-17 listForAdmin) and Person 1 (ACC-12
  // hasUpcomingConfirmedBookings) connect these on their side.
  exports: [HotelBookingsService],
})
export class HotelBookingsModule {}
