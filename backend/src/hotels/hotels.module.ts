import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { Hotel, HotelSchema } from './schemas/hotel.schema';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';
import { OptionalAuthGuard } from './optional-auth.guard';

@Module({
  imports: [AuthModule, ReferenceDataModule, MongooseModule.forFeature([{ name: Hotel.name, schema: HotelSchema }])],
  controllers: [HotelsController],
  providers: [HotelsService, OptionalAuthGuard],
  exports: [HotelsService],
})
export class HotelsModule {}
