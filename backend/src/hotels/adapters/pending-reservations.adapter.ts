import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HotelReservationsPage, HotelReservationsPort } from '../ports/hotel-reservations.port';

/**
 * Temporary binding until Person 6's hotel-bookings module exists. Replace it in HotelsModule with
 * an adapter that calls that service; nothing else changes. Mirrors the itineraries module's
 * PendingFlightSearchAdapter/PendingHotelSearchAdapter.
 */
@Injectable()
export class PendingHotelReservationsAdapter implements HotelReservationsPort {
  async listForHotel(): Promise<HotelReservationsPage> {
    throw new ServiceUnavailableException('Hotel reservations are not available yet');
  }
}
