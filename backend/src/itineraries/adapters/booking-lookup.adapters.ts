import { Injectable } from '@nestjs/common';
import { FlightBookingsService } from '../../flight-bookings/flight-bookings.service';
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
 * ITN-27: reads one of the user's flight bookings through FlightBookingsService.getMine
 * (Person 4). Read-only; getMine returns 404 for another user's booking. totalAmount is USD
 * minor units (PAY-04). The link day is the local departure date of the first segment, in
 * that airport's IANA time zone.
 */
@Injectable()
export class FlightBookingLookupAdapter implements ItineraryBookingsPort {
  constructor(private readonly flightBookings: FlightBookingsService) {}

  async getOwnBooking(bookingId: string, userId: string): Promise<LinkableBooking> {
    const booking = await this.flightBookings.getMine(bookingId, userId);
    const segments = [...booking.segments].sort((a, b) => a.departureAt.getTime() - b.departureAt.getTime());
    const first = segments[0];
    return {
      status: booking.status,
      amountMinor: booking.totalAmount,
      currency: booking.currency,
      ...(booking.bookingReference ? { bookingReference: booking.bookingReference } : {}),
      label: segments.map((segment) => `${segment.flightNumber} ${segment.departureAirportCode}-${segment.arrivalAirportCode}`).join(', '),
      startDate: localDate(first.departureAt, first.departureTimeZone),
    };
  }
}

/** YYYY-MM-DD of an instant in an IANA time zone (e.g. 2026-12-20T23:30Z in Africa/Cairo is 2026-12-21). */
export function localDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const part = (type: string) => parts.find((candidate) => candidate.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
