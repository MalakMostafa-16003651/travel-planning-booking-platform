import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlightBookingChange, FlightBookingChangeSchema } from './schemas/flight-booking-change.schema';
import { FlightBookingChangesStore } from './flight-booking-changes.store';
@Module({
  imports: [MongooseModule.forFeature([{ name: FlightBookingChange.name, schema: FlightBookingChangeSchema }])],
  providers: [FlightBookingChangesStore], exports: [FlightBookingChangesStore],
})
export class FlightBookingChangesPersistenceModule {}
