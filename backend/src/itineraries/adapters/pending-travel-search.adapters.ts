import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { FlightSearchPort, HotelSearchPort } from '../ports/travel-search.port';

/**
 * Temporary bindings until FlightsService and HotelsService exist. Replace them in
 * ItinerariesModule with adapters that call those services; nothing else changes.
 */
@Injectable()
export class PendingFlightSearchAdapter implements FlightSearchPort {
  async search(): Promise<unknown> {
    throw new ServiceUnavailableException('Flight search is not available yet');
  }
}

@Injectable()
export class PendingHotelSearchAdapter implements HotelSearchPort {
  async search(): Promise<unknown> {
    throw new ServiceUnavailableException('Hotel search is not available yet');
  }
}
