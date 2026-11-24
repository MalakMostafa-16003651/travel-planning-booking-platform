export type HotelSort = "NAME" | "PRICE_ASC" | "PRICE_DESC" | "RATING_DESC";
export const HOTEL_SORTS: HotelSort[] = ["NAME", "PRICE_ASC", "PRICE_DESC", "RATING_DESC"];

/** Matches backend HotelSearchResult (hotels/hotels.service.ts) exactly. */
export interface HotelSearchResult {
  hotelId: string;
  name: string;
  city: string;
  countryCode: string;
  checkInTime: string;
  checkOutTime: string;
  /** Cheapest qualifying room's nightly price, integer minor units. */
  fromPrice: number;
  currency: string;
  availableRooms: number;
  starClass?: number;
  amenities?: string[];
  averageRating: number | null;
  ratingCount: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface HotelSearchCriteria {
  city?: string;
  countryCode?: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms: number;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  sort?: HotelSort;
}

/** Selection handed off to Osama's booking flow once HTL-15 room selection is built. */
export interface HotelSelection {
  hotelId: string;
  roomIds: string[];
  checkIn: string;
  checkOut: string;
  adults: number;
  childrenAges: number[];
}
