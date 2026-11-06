import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { Hotel, HotelSchema } from './schemas/hotel.schema';
import { Room, RoomSchema } from './schemas/room.schema';
import { RoomAvailability, RoomAvailabilitySchema } from './schemas/room-availability.schema';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';
import { OptionalAuthGuard } from './optional-auth.guard';

@Module({
  imports: [
    AuthModule,
    ReferenceDataModule,
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
      { name: RoomAvailability.name, schema: RoomAvailabilitySchema },
    ]),
  ],
  controllers: [HotelsController],
  providers: [HotelsService, OptionalAuthGuard],
  exports: [HotelsService],
})
export class HotelsModule {}
