import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { FlightSearchPort } from '../ports/travel-search.port';

/**
 * Temporary binding until the ITN-26 mapping onto FlightsService is agreed with Person 3:
 * the itinerary searches every official airport of the destination city, while
 * FlightsService.search takes a single arrivalAirportCode and paginates internally. See the
 * itinerary contract. Replace this binding in ItinerariesModule; nothing else changes.
 */
@Injectable()
export class PendingFlightSearchAdapter implements FlightSearchPort {
  async search(): Promise<unknown> {
    throw new ServiceUnavailableException('Flight search is not available yet');
  }
}
