import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Hotel, HotelSchema } from '../hotels/schemas/hotel.schema';
import { RoomAvailability, RoomAvailabilitySchema } from '../hotels/schemas/room-availability.schema';
import { Room, RoomSchema } from '../hotels/schemas/room.schema';
import { RoomInventoryAdapter } from './adapters/room-inventory.adapter';
import { HotelBookingsClock } from './hotel-booking.dates';
import { HotelBookingsMaintenanceService } from './hotel-bookings-maintenance.service';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelBookingsService } from './hotel-bookings.service';
import { HotelBooking, HotelBookingSchema } from './schemas/hotel-booking.schema';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: HotelBooking.name, schema: HotelBookingSchema },
      // Person 5's schemas, reused unchanged for RoomInventoryAdapter (read hotels/rooms, write bookedRanges only).
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
      { name: RoomAvailability.name, schema: RoomAvailabilitySchema },
    ]),
  ],
  controllers: [HotelBookingsController],
  providers: [HotelBookingsService, HotelBookingsMaintenanceService, HotelBookingsClock, RoomInventoryAdapter],
  // Person 5 (HTL-22 listForHotel), Person 2 (ACC-17 listForAdmin) and Person 1 (ACC-12
  // hasUpcomingConfirmedBookings) connect these on their side.
  exports: [HotelBookingsService],
})
export class HotelBookingsModule {}
