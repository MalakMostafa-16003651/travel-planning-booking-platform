import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesModule } from '../airlines/airlines.module';
import { AuthModule } from '../auth/auth.module';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';
import { Airport, AirportSchema } from '../airports/schemas/airport.schema';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import {CabinInventory,CabinInventorySchema,} from './schemas/cabin-inventory.schema';
import { Flight, FlightSchema } from './schemas/flight.schema';

@Module({
imports: [
AuthModule,
AirlinesModule,

MongooseModule.forFeature([
  { name: Airline.name, schema: AirlineSchema },
  { name: Airport.name, schema: AirportSchema },
  { name: Flight.name, schema: FlightSchema },
  { name: CabinInventory.name, schema: CabinInventorySchema },
]),


],

controllers: [FlightsController],

providers: [FlightsService],

exports: [FlightsService],
})
export class FlightsModule {}
