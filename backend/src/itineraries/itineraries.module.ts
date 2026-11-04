import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { InterimAuthorsAdapter, InterimCurrenciesAdapter } from './adapters/interim.adapters';
import { PendingFlightSearchAdapter, PendingHotelSearchAdapter } from './adapters/pending-travel-search.adapters';
import { ExchangeRatesService } from './currency/exchange-rates.service';
import { FxRatesClient } from './currency/fx-rates.client';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { ItineraryItemsController } from './itinerary-items.controller';
import { OptionalAuthGuard } from './optional-auth.guard';
import { ITINERARY_AUTHORS } from './ports/itinerary-authors.port';
import { ITINERARY_CURRENCIES } from './ports/itinerary-currencies.port';
import { ITINERARY_FLIGHT_SEARCH, ITINERARY_HOTEL_SEARCH } from './ports/travel-search.port';
import { ActivityImage, ActivityImageSchema } from './schemas/activity-image.schema';
import { ExchangeRate, ExchangeRateSchema } from './schemas/exchange-rate.schema';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
      { name: ActivityImage.name, schema: ActivityImageSchema },
      { name: ExchangeRate.name, schema: ExchangeRateSchema },
      // Read-only: preferredCurrency for the default itinerary currency.
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [ItinerariesController, ItineraryItemsController],
  providers: [
    ItinerariesService,
    ExchangeRatesService,
    FxRatesClient,
    OptionalAuthGuard,
    // Swap these for the real modules as they land; nothing else in this module changes.
    { provide: ITINERARY_AUTHORS, useClass: InterimAuthorsAdapter }, // -> UsersService (Person 1)
    { provide: ITINERARY_CURRENCIES, useClass: InterimCurrenciesAdapter }, // -> CurrenciesService (PR #10)
    { provide: ITINERARY_FLIGHT_SEARCH, useClass: PendingFlightSearchAdapter }, // -> FlightsService (Person 3)
    { provide: ITINERARY_HOTEL_SEARCH, useClass: PendingHotelSearchAdapter }, // -> HotelsService (Person 5)
  ],
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
