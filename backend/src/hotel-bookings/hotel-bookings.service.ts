import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { HotelBookingDto, HotelBookingPageDto } from './dto/hotel-booking-response.dto';
import { HotelBookingGroup } from './dto/list-hotel-bookings-query.dto';
import { HOTEL_BOOKINGS_PAGE_SIZE } from './hotel-booking.constants';
import { HotelBookingsClock } from './hotel-booking.dates';
import { HotelBooking, HotelBookingDocument } from './schemas/hotel-booking.schema';

/** One reservation as another owner's view needs it (HTL-22 moderator view, ACC-17 admin view). */
export interface HotelBookingSummary {
  hotelBookingId: string;
  bookingReference?: string;
  userId: string;
  hotelId: string;
  hotelName: string;
  rooms: { roomId: string; roomName: string; adults: number; childrenAges: number[] }[];
  checkIn: string;
  checkOut: string;
  guestCount: number;
  totalPrice: number;
  currency: string;
  status: BookingStatus;
}

export interface HotelBookingSummaryPage {
  items: HotelBookingSummary[];
  page: number;
  pageSize: number;
  total: number;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function toObjectId(id: string, message: string): Types.ObjectId {
  if (!/^[0-9a-f]{24}$/i.test(id)) throw new NotFoundException(message);
  return new Types.ObjectId(id);
}

function summarize(booking: HotelBooking): HotelBookingSummary {
  return {
    hotelBookingId: booking._id.toString(),
    bookingReference: booking.bookingReference,
    userId: booking.userId.toString(),
    hotelId: booking.hotelId.toString(),
    hotelName: booking.hotelName,
    rooms: booking.rooms.map((room) => ({
      roomId: room.roomId.toString(),
      roomName: room.roomName,
      adults: room.adults,
      childrenAges: [...room.childrenAges],
    })),
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    guestCount: booking.rooms.reduce((sum, room) => sum + room.adults + room.childrenAges.length, 0),
    totalPrice: booking.totalPrice,
    currency: booking.currency,
    status: booking.status,
  };
}

@Injectable()
export class HotelBookingsService {
  constructor(
    @InjectModel(HotelBooking.name) private readonly bookings: Model<HotelBookingDocument>,
    private readonly clock: HotelBookingsClock,
  ) {}

  /**
   * HTL-20: the caller's own reservations, page size 10 (GEN-05). CANCELLED includes EXPIRED
   * (team-leader decision 2026-11-08). "Today" is the UTC calendar date (contract L2). A stay is over
   * once its check-out date arrives, so PAST also shows Confirmed stays the completion sweep has
   * not reached yet.
   */
  async listMine(userId: string, group: HotelBookingGroup | undefined, page = 1): Promise<HotelBookingPageDto> {
    const owner = { userId: new Types.ObjectId(userId) };
    const today = this.clock.today();
    const filters: Record<HotelBookingGroup, QueryFilter<HotelBooking>> = {
      [HotelBookingGroup.UPCOMING]: { ...owner, status: { $in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] }, checkOut: { $gt: today } },
      [HotelBookingGroup.PAST]: {
        ...owner,
        $or: [{ status: BookingStatus.COMPLETED }, { status: BookingStatus.CONFIRMED, checkOut: { $lte: today } }],
      },
      [HotelBookingGroup.CANCELLED]: { ...owner, status: { $in: [BookingStatus.CANCELLED, BookingStatus.EXPIRED] } },
    };
    const sorts: Record<HotelBookingGroup, Record<string, 1 | -1>> = {
      [HotelBookingGroup.UPCOMING]: { checkIn: 1, _id: 1 },
      [HotelBookingGroup.PAST]: { checkOut: -1, _id: -1 },
      [HotelBookingGroup.CANCELLED]: { checkIn: -1, _id: -1 },
    };
    const filter = group ? filters[group] : owner;
    const sort = group ? sorts[group] : { _id: -1 as const };
    const [items, total] = await Promise.all([
      this.bookings.find(filter).sort(sort).skip((page - 1) * HOTEL_BOOKINGS_PAGE_SIZE).limit(HOTEL_BOOKINGS_PAGE_SIZE).exec(),
      this.bookings.countDocuments(filter).exec(),
    ]);
    return { items: items.map(HotelBookingDto.from), page, pageSize: HOTEL_BOOKINGS_PAGE_SIZE, total };
  }

  /** HTL-20, ACC-11: owner only. Another user's reservation is "not found", never "forbidden". */
  async getMine(hotelBookingId: string, userId: string): Promise<HotelBookingDocument> {
    const booking = await this.bookings.findOne({
      _id: toObjectId(hotelBookingId, 'Hotel booking not found'),
      userId: new Types.ObjectId(userId),
    }).exec();
    if (!booking) throw new NotFoundException('Hotel booking not found');
    return booking;
  }

  /**
   * HTL-22 (Person 5 connects this): reservations of one hotel, nearest check-in first. Expired holds
   * were never reservations and are left out. The caller checks the moderator's hotel assignment.
   */
  async listForHotel(hotelId: string, page = 1): Promise<HotelBookingSummaryPage> {
    const filter: QueryFilter<HotelBooking> = {
      hotelId: toObjectId(hotelId, 'Hotel not found'),
      status: { $ne: BookingStatus.EXPIRED },
    };
    return this.page(filter, { checkIn: 1, _id: 1 }, page);
  }

  /** ACC-17 (Person 2 connects this): read-only, filterable by status and an inclusive check-in date range. */
  async listForAdmin(options: { status?: BookingStatus; from?: string; to?: string; page?: number }): Promise<HotelBookingSummaryPage> {
    const filter: QueryFilter<HotelBooking> = {};
    if (options.status) filter.status = options.status;
    if (options.from !== undefined || options.to !== undefined) {
      const errors: Record<string, string[]> = {};
      if (options.from !== undefined && !DATE_ONLY.test(options.from)) errors.from = ['From must be YYYY-MM-DD'];
      if (options.to !== undefined && !DATE_ONLY.test(options.to)) errors.to = ['To must be YYYY-MM-DD'];
      if (Object.keys(errors).length > 0) throw new BadRequestException({ message: 'Validation failed', errors });
      filter.checkIn = {
        ...(options.from !== undefined ? { $gte: options.from } : {}),
        ...(options.to !== undefined ? { $lte: options.to } : {}),
      };
    }
    return this.page(filter, { _id: -1 }, options.page ?? 1);
  }

  /**
   * ACC-12 (Person 1 connects this): true while the user has a Confirmed stay whose check-out date is
   * still ahead (UTC calendar date), which includes a stay in progress. Such a user cannot deactivate.
   */
  async hasUpcomingConfirmedBookings(userId: string): Promise<boolean> {
    if (!/^[0-9a-f]{24}$/i.test(userId)) return false;
    const found = await this.bookings.exists({
      userId: new Types.ObjectId(userId),
      status: BookingStatus.CONFIRMED,
      checkOut: { $gt: this.clock.today() },
    }).exec();
    return found !== null;
  }

  // Scheduled work (HotelBookingsMaintenanceService)

  /**
   * GEN-11/HTL-23: Confirmed becomes Completed once the check-out date has arrived (UTC calendar date),
   * the same boundary as the PAST group. Conditional on CONFIRMED, so it is safe to run on several servers
   * and never touches cancelled or pending reservations.
   */
  async completeFinishedStays(today: string = this.clock.today()): Promise<number> {
    const result = await this.bookings.updateMany(
      { status: BookingStatus.CONFIRMED, checkOut: { $lte: today } },
      { $set: { status: BookingStatus.COMPLETED, completedAt: new Date() } },
    ).exec();
    return result.modifiedCount;
  }

  private async page(filter: QueryFilter<HotelBooking>, sort: Record<string, 1 | -1>, page: number): Promise<HotelBookingSummaryPage> {
    const [items, total] = await Promise.all([
      this.bookings.find(filter).sort(sort).skip((page - 1) * HOTEL_BOOKINGS_PAGE_SIZE).limit(HOTEL_BOOKINGS_PAGE_SIZE).exec(),
      this.bookings.countDocuments(filter).exec(),
    ]);
    return { items: items.map(summarize), page, pageSize: HOTEL_BOOKINGS_PAGE_SIZE, total };
  }
}
