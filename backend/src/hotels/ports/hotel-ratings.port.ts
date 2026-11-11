export const HOTEL_RATINGS = 'HOTEL_RATINGS';

export interface RatingStats {
  averageRating: number;
  ratingCount: number;
}

/**
 * HTL-02/HTL-12: owned here (the consumer), satisfied by Person 6's ReviewsService.getRatingStats.
 * Kept as a token/interface rather than importing ReviewsService directly: that class already
 * imports HotelsService, and hotels.service.ts importing reviews.service.ts back would be a real
 * circular file import (not just a circular Nest module), which breaks constructor-parameter
 * decorator metadata no matter how the injection itself is wrapped.
 */
export interface HotelRatingsPort {
  getRatingStats(hotelIds: string[]): Promise<Map<string, RatingStats>>;
}
