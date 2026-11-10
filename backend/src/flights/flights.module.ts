import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesModule } from '../airlines/airlines.module';
import { AuthModule } from '../auth/auth.module';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import {Airline,AirlineSchema,} from '../airlines/schemas/airline.schema';
import { Airport, AirportSchema,} from '../airports/schemas/airport.schema';
import { ItineraryFlightSearchAdapter } from './adapters/itinerary-flight-search.adapter';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import { FlightsMaintenanceService } from './flights-maintenance.service';
import {CabinInventory,CabinInventorySchema,} from './schemas/cabin-inventory.schema';
import {Flight,FlightSchema,} from './schemas/flight.schema';

@Module({
  imports: [
    AuthModule,
    AirlinesModule,
    FlightBookingsModule,
    NotificationsModule,

    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: Airport.name, schema: AirportSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: CabinInventory.name, schema: CabinInventorySchema },
    ]),
  ],

  controllers: [
    FlightsController,
  ],

  providers: [
    FlightsService,
    FlightsMaintenanceService,
    ItineraryFlightSearchAdapter,
  ],

  exports: [
    FlightsService,
    ItineraryFlightSearchAdapter,
  ],
})
export class FlightsModule {}
