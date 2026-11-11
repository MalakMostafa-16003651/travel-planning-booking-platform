import { FlightSeatsPersistenceModule } from '../flight-bookings/flight-seats-persistence.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AirlinesModule } from '../airlines/airlines.module';
import { AuthModule } from '../auth/auth.module';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import {Airline,AirlineSchema,} from '../airlines/schemas/airline.schema';
import { Airport, AirportSchema,} from '../airports/schemas/airport.schema';
import { ItineraryFlightSearchAdapter } from './adapters/itinerary-flight-search.adapter';
import { FlightPassengerExportController } from './flight-passenger-export.controller';
import { FlightPassengerExportService } from './flight-passenger-export.service';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import { FlightsMaintenanceService } from './flights-maintenance.service';
import {CabinInventory,CabinInventorySchema,} from './schemas/cabin-inventory.schema';
import {Flight,FlightSchema,} from './schemas/flight.schema';

@Module({
  imports: [
    AuthModule,
    FlightSeatsPersistenceModule,
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
    FlightPassengerExportController,
  ],

  providers: [
    FlightsService,
    FlightsMaintenanceService,
    ItineraryFlightSearchAdapter,
    FlightPassengerExportService,
  ],

  exports: [
    FlightsService,
    ItineraryFlightSearchAdapter,
  ],
})
export class FlightsModule {}
