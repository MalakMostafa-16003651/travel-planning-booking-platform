import { Injectable } from '@nestjs/common';
import { FlightSearchPort, ItineraryFlightSearch } from '../../itineraries/ports/travel-search.port';
import { FlightsService } from '../flights.service';

/**
 * ITN-26: lets Person 7's itinerary module search flights through FlightsService.
 * Person 7 binds it with:  { provide: ITINERARY_FLIGHT_SEARCH, useExisting: ItineraryFlightSearchAdapter }
 */
@Injectable()
export class ItineraryFlightSearchAdapter implements FlightSearchPort {
  constructor(private readonly flights: FlightsService) {}

  search(criteria: ItineraryFlightSearch): Promise<unknown> {
    return this.flights.searchForItinerary(criteria);
  }
}
