export const HOTEL_RESERVATIONS = 'HOTEL_RESERVATIONS';

export interface HotelReservationSummary {
  hotelBookingId: string;
  userId: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  status: string;
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

/** HTL-22: everything the moderator reservations view needs from the future hotel-bookings module (Person 6). */
export interface HotelReservationsPort {
  listForHotel(hotelId: string, page: number): Promise<HotelReservationsPage>;
}
