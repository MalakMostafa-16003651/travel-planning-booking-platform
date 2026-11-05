export const ITINERARY_FLIGHT_SEARCH = 'ITINERARY_FLIGHT_SEARCH';
export const ITINERARY_HOTEL_SEARCH = 'ITINERARY_HOTEL_SEARCH';

/**
 * ITN-26: what the itinerary needs from the Flights module (Person 3). The itinerary only
 * derives the route and date; filtering, sorting and results stay owned by FlightsService.
 */
export interface ItineraryFlightSearch {
  originCity: string;
  originCountryCode?: string;
  destinationCity: string;
  destinationCountryCode?: string;
  /** YYYY-MM-DD */
  departureDate: string;
  adults: number;
  children: number;
  infants: number;
  cabinClass?: string;
  page?: number;
}

export interface FlightSearchPort {
  search(criteria: ItineraryFlightSearch): Promise<unknown>;
}

/**
 * ITN-25: what the itinerary needs from the Hotels module (Person 5). Backed by the same
 * search as HTL-11/HTL-12 (GET /api/hotels/search); availability, filtering and sorting stay
 * owned by HotelsService.
 */
export interface ItineraryHotelSearch {
  city: string;
  countryCode?: string;
  /** YYYY-MM-DD */
  checkIn: string;
  /** YYYY-MM-DD */
  checkOut: string;
  guests: number;
  page?: number;
}

export interface HotelSearchPort {
  search(criteria: ItineraryHotelSearch): Promise<unknown>;
}
