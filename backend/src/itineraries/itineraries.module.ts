import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { CurrenciesModule } from '../currencies/currencies.module';
import { CurrenciesService } from '../currencies/currencies.service';
import { User, UserSchema } from '../users/schemas/user.schema';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';
import { AirportsModule } from '../airports/airports.module';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { HotelsModule } from '../hotels/hotels.module';
import { HotelsServiceSearchAdapter } from './adapters/hotel-search.adapter';
import { ItineraryFlightSearchAdapter } from '../flights/adapters/itinerary-flight-search.adapter';
import { FlightsModule } from '../flights/flights.module';
import { ExchangeRatesService } from './currency/exchange-rates.service';
import { FxRatesClient } from './currency/fx-rates.client';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { ItineraryItemsController } from './itinerary-items.controller';
import { OptionalAuthGuard } from './optional-auth.guard';
import { ITINERARY_ACCOUNT_STATUSES, ITINERARY_AUTHOR_NAMES } from './ports/itinerary-authors.port';
import { ITINERARY_CURRENCIES } from './ports/itinerary-currencies.port';
import { ITINERARY_FLIGHT_SEARCH, ITINERARY_HOTEL_SEARCH } from './ports/travel-search.port';
import { ActivityImage, ActivityImageSchema } from './schemas/activity-image.schema';
import { ExchangeRate, ExchangeRateSchema } from './schemas/exchange-rate.schema';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';

@Module({
  imports: [
    AuthModule,
    CurrenciesModule,
    UsersModule,
    ReferenceDataModule,
    AirportsModule,
    HotelsModule,
    FlightsModule,
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
      { name: ActivityImage.name, schema: ActivityImageSchema },
      { name: ExchangeRate.name, schema: ExchangeRateSchema },
      // Read-only preference lookup; attribution/status use UsersService.
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [ItinerariesController, ItineraryItemsController],
  providers: [
    ItinerariesService,
    ExchangeRatesService,
    FxRatesClient,
    OptionalAuthGuard,
    // Shared services from other modules, bound to this module's ports.
    { provide: ITINERARY_ACCOUNT_STATUSES, useExisting: UsersService },
    { provide: ITINERARY_AUTHOR_NAMES, useExisting: UsersService },
    { provide: ITINERARY_CURRENCIES, useExisting: CurrenciesService },
    { provide: ITINERARY_FLIGHT_SEARCH, useExisting: ItineraryFlightSearchAdapter }, // FlightsService.searchForItinerary (FLT-11, FLT-12, FLT-15)
    { provide: ITINERARY_HOTEL_SEARCH, useClass: HotelsServiceSearchAdapter }, // HotelsService.search (HTL-11, HTL-12)
  ],
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
