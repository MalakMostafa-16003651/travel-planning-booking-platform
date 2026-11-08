import { Injectable } from '@nestjs/common';
import { SearchHotelsQueryDto } from '../../hotels/dto/search-hotels-query.dto';
import { HotelsService } from '../../hotels/hotels.service';
import { HotelSearchPort, ItineraryHotelSearch } from '../ports/travel-search.port';

/**
 * ITN-25: reuses the Hotels module search (HTL-11, HTL-12) unchanged. The itinerary only
 * supplies the city stop and its dates; availability, pricing, sorting and pagination stay
 * owned by HotelsService (Person 5).
 */
@Injectable()
export class HotelsServiceSearchAdapter implements HotelSearchPort {
  constructor(private readonly hotels: HotelsService) {}

  search(criteria: ItineraryHotelSearch) {
    const query: SearchHotelsQueryDto = {
      city: criteria.city,
      ...(criteria.countryCode ? { countryCode: criteria.countryCode } : {}),
      checkIn: criteria.checkIn,
      checkOut: criteria.checkOut,
      guests: criteria.guests,
      rooms: criteria.rooms,
      ...(criteria.page ? { page: criteria.page } : {}),
    };
    return this.hotels.search(query);
  }
}
