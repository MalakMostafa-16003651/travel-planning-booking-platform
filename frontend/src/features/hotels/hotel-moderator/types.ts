import type { CancellationTier, HotelPhoto } from "../hotel-detail/types";
import type { Page } from "../hotel-search/types";

export interface MyHotel {
  _id: string;
  name: string;
  city: string;
  countryCode: string;
  address: string;
  description: string | null;
  starClass?: number;
  amenities?: string[];
  isActive: boolean;
  checkInTime: string;
  checkOutTime: string;
  cancellationTiers: CancellationTier[];
  photos: HotelPhoto[];
}

export interface ModeratorRoom {
  _id: string;
  hotelId: string;
  name: string;
  type?: string;
  beds?: number;
  capacity: number;
  pricePerNight: number;
  isActive: boolean;
}

export type RoomsPage = Page<ModeratorRoom>;

export interface RoomDay {
  date: string;
  status: "AVAILABLE" | "BOOKED" | "BLOCKED";
  bookingReference?: string;
  bookingStatus?: string;
  reason?: string;
}

export interface BookableRange {
  startDate: string;
  endDate: string;
}

export interface BlockedRange {
  _id: string;
  startDate: string;
  endDate: string;
  reason?: string;
}

export interface RoomAvailabilityItem {
  roomId: string;
  roomName: string;
  isActive: boolean;
  bookableRanges: BookableRange[];
  blockedRanges: BlockedRange[];
  days: RoomDay[];
}

export interface RoomAvailabilityPage {
  items: RoomAvailabilityItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  from: string;
  to: string;
}

export interface ReservationRoom {
  roomId: string;
  roomName: string;
  adults: number;
  childrenAges: number[];
}

export interface Reservation {
  hotelBookingId: string;
  bookingReference?: string;
  userId: string;
  guestName?: string;
  rooms: ReservationRoom[];
  checkIn: string;
  checkOut: string;
  guestCount: number;
  status: string;
  totalAmount: number;
  currency: string;
}

export type ReservationsPage = Page<Reservation>;
