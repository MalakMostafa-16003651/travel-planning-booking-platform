import { ReviewRatingsModule } from '../reviews/review-ratings.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { HotelBookingsReservationsAdapter } from './adapters/hotel-bookings-reservations.adapter';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import { UsersModule } from '../users/users.module';
import { HOTEL_RESERVATIONS } from './ports/hotel-reservations.port';
import { Hotel, HotelSchema } from './schemas/hotel.schema';
import { HotelPhoto, HotelPhotoSchema } from './schemas/hotel-photo.schema';
import { Room, RoomSchema } from './schemas/room.schema';
import { RoomAvailability, RoomAvailabilitySchema } from './schemas/room-availability.schema';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';
import { OptionalAuthGuard } from './optional-auth.guard';

@Module({
  imports: [
    AuthModule,
    ReviewRatingsModule,
    AuditLogsModule,
    ReferenceDataModule,
    HotelBookingsModule,
    UsersModule,
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
      { name: RoomAvailability.name, schema: RoomAvailabilitySchema },
      { name: HotelPhoto.name, schema: HotelPhotoSchema },
    ]),
  ],
  controllers: [HotelsController],
  providers: [
    HotelsService,
    OptionalAuthGuard,
    { provide: HOTEL_RESERVATIONS, useClass: HotelBookingsReservationsAdapter },
  ],
  exports: [HotelsService],
})
export class HotelsModule {}
