import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HotelBookingsService } from '../../hotel-bookings/hotel-bookings.service';
import { ItineraryBookingsPort, LinkableBooking } from '../ports/itinerary-bookings.port';

/**
 * ITN-27: reads one of the user's hotel bookings through HotelBookingsService.getMine
 * (Person 6). Field names and meanings confirmed by Osama on 2026-11-10: totalPrice is USD
 * minor units, checkIn/checkOut are YYYY-MM-DD, check-out is the departure day, and getMine
 * returns 404 for another user's booking.
 */
@Injectable()
export class HotelBookingLookupAdapter implements ItineraryBookingsPort {
  constructor(private readonly hotelBookings: HotelBookingsService) {}

  async getOwnBooking(bookingId: string, userId: string): Promise<LinkableBooking> {
    const booking = await this.hotelBookings.getMine(bookingId, userId);
    return {
      status: booking.status,
      amountMinor: booking.totalPrice,
      currency: booking.currency,
      ...(booking.bookingReference ? { bookingReference: booking.bookingReference } : {}),
      label: booking.hotelName,
      startDate: booking.checkIn,
      endDate: booking.checkOut,
    };
  }
}

/**
 * Temporary binding until Person 4 (Ismail) confirms FlightBookingsService.getMine as the
 * interface (see docs/requirements/itn-27-linked-bookings-proposal.md). Replace this binding
 * in ItinerariesModule; nothing else changes.
 */
@Injectable()
export class PendingFlightBookingLookupAdapter implements ItineraryBookingsPort {
  async getOwnBooking(): Promise<LinkableBooking> {
    throw new ServiceUnavailableException('Linking flight bookings is not available yet');
  }
}
