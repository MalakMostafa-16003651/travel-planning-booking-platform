import { BookingStatus } from '../../common/enums/booking-status.enum';
export const HOTEL_RESERVATIONS = 'HOTEL_RESERVATIONS';

export interface HotelReservationSummary {
  hotelBookingId: string;
  bookingReference?: string;
  userId: string;
  guestName?: string;
  rooms: { roomId: string; roomName: string; adults: number; childrenAges: number[] }[];
  checkIn: string;
  checkOut: string;
  guestCount: number;
  status: BookingStatus;
  totalAmount: number;
  currency: string;
}
export interface HotelReservationsPage {
  items: HotelReservationSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
/** ACC-11/HTL-22: moderator ownership is enforced before calling this read-only port. */
export interface HotelReservationsPort {
  listForHotel(hotelId: string, page: number): Promise<HotelReservationsPage>;
}
