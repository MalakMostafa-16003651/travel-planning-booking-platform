import { Injectable } from '@nestjs/common';
import { HotelBookingsService } from '../../hotel-bookings/hotel-bookings.service';
import { UsersService } from '../../users/users.service';
import { HotelReservationsPage, HotelReservationsPort } from '../ports/hotel-reservations.port';

@Injectable()
export class HotelBookingsReservationsAdapter implements HotelReservationsPort {
  constructor(private readonly bookings: HotelBookingsService, private readonly users: UsersService) {}
  async listForHotel(hotelId: string, page: number): Promise<HotelReservationsPage> {
    const result = await this.bookings.listForHotel(hotelId, page);
    const names = await this.users.getDisplayNames(result.items.map((item) => item.userId));
    return {
      items: result.items.map((item) => ({
        hotelBookingId: item.hotelBookingId, bookingReference: item.bookingReference,
        userId: item.userId, guestName: names.get(item.userId),
        rooms: item.rooms, checkIn: item.checkIn, checkOut: item.checkOut,
        guestCount: item.guestCount, status: item.status,
        totalAmount: item.totalPrice, currency: item.currency,
      })),
      page: result.page, pageSize: result.pageSize, total: result.total,
      totalPages: Math.ceil(result.total / result.pageSize),
    };
  }
}
