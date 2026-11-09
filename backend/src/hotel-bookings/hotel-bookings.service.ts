import { BookingPaymentsAdapter } from '../payments/adapters/booking-payments.adapter';
import { HOLD_EXPIRED_REASON } from '../payments/payments.service';
import { randomBytes } from 'node:crypto';
import { UsersService } from '../users/users.service';
import { AccountStatus } from '../common/enums/account-status.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { Payment } from '../payments/schemas/payment.schema';
import { PaymentStatus } from '../payments/payment-status.enum';
import { toMinorUnits } from '../payments/money';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailEligibilityService } from '../auth/email-eligibility.service';
import { BadRequestException, ConflictException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, QueryFilter, Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
// PAY-04: the single platform currency, the same constant flight bookings and payments use.
import { PLATFORM_CURRENCY } from '../flight-bookings/flight-booking.rules';
import { RoomInventoryAdapter } from './adapters/room-inventory.adapter';
import { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import { HotelBookingDto, HotelBookingPageDto } from './dto/hotel-booking-response.dto';
import { HotelBookingGroup } from './dto/list-hotel-bookings-query.dto';
import { HOTEL_BOOKING_HOLD_MS, HOTEL_BOOKINGS_PAGE_SIZE } from './hotel-booking.constants';
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
const SWEEP_BATCH_SIZE = 100;

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
  private readonly logger = new Logger(HotelBookingsService.name);
  constructor(
    @InjectModel(HotelBooking.name) private readonly bookings: Model<HotelBookingDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly clock: HotelBookingsClock,
    private readonly inventory: RoomInventoryAdapter,
    private readonly emailEligibility: EmailEligibilityService,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @Inject(forwardRef(() => BookingPaymentsAdapter)) private readonly bookingPayments: BookingPaymentsAdapter,
  ) {}

  /**
   * HTL-16/HTL-18: validates the request, prices it from the rooms' current prices, then holds every
   * room for 10 minutes and saves one PENDING reservation in ONE transaction. If any room overlaps a
   * blocked range, a booked range or an unexpired hold, the transaction aborts: 409 and nothing is held.
   */
  async hold(input: CreateHotelBookingDto, userId: string): Promise<HotelBookingDto> {
    await this.emailEligibility.assertCanBook(userId);
    const errors: Record<string, string[]> = {};
    const fail = (field: string, message: string) => { (errors[field] ??= []).push(message); };

    if (input.checkOut <= input.checkIn) fail('checkOut', 'Check-out must be after check-in');
    if (input.checkIn < this.clock.today()) fail('checkIn', 'Check-in cannot be in the past');
    const roomIds = input.rooms.map((room) => room.roomId.toLowerCase());
    if (new Set(roomIds).size !== roomIds.length) fail('rooms', 'Each room can be selected only once');
    if (input.rooms.reduce((sum, room) => sum + room.adults, 0) < 1) fail('rooms', 'At least one adult is required');
    // HTL-16 assigns guests to each room, so every selected room needs at least one guest.
    input.rooms.forEach((room, index) => {
      if (room.adults + room.childrenAges.length < 1) fail(`rooms.${index}`, 'Each room needs at least one guest');
    });
    if (Object.keys(errors).length > 0) throw new BadRequestException({ message: 'Validation failed', errors });

    // 404, like flight bookings ("Flight or cabin not found") and the hotel detail: an unknown or
    // deactivated hotel (ACC-15), and an unknown or inactive room or a room of another hotel, do not exist
    // for booking. Real input errors (dates, guests, capacity, repeated rooms) stay 400.
    const hotel = await this.inventory.getHotel(input.hotelId);
    if (!hotel || !hotel.isActive) throw new NotFoundException('Hotel not found');
    const found = new Map((await this.inventory.getRooms(roomIds)).map((room) => [room._id.toString(), room]));
    const missing = input.rooms.some((request) => {
      const room = found.get(request.roomId.toLowerCase());
      return !room || !room.hotelId.equals(hotel._id) || !room.isActive;
    });
    if (missing) throw new NotFoundException('Room not found in this hotel');
    const selected = input.rooms.map((request, index) => {
      const room = found.get(request.roomId.toLowerCase())!;
      const guests = request.adults + request.childrenAges.length;
      if (guests > room.capacity) fail(`rooms.${index}`, `${room.name} holds at most ${room.capacity} guests`);
      return { room, request };
    });
    if (Object.keys(errors).length > 0) throw new BadRequestException({ message: 'Validation failed', errors });

    const nights = Math.round((Date.parse(`${input.checkOut}T00:00:00Z`) - Date.parse(`${input.checkIn}T00:00:00Z`)) / 86_400_000);
    // HTL-16/HTL-05: name and price are copied now, so later room edits never change this reservation.
    const rooms = selected.map((entry) => {
      const { room, request } = entry;
      return {
        roomId: room._id,
        roomName: room.name,
        pricePerNight: room.pricePerNight,
        adults: request.adults,
        childrenAges: request.childrenAges,
        subtotal: nights * room.pricePerNight,
      };
    });

    await this.inventory.ensureAvailability(selected.map((entry) => entry.room));
    const hotelBookingId = new Types.ObjectId();
    const now = new Date();
    const holdExpiresAt = new Date(now.getTime() + HOTEL_BOOKING_HOLD_MS);
    const booking = await this.connection.transaction(async (session) => {
      await this.emailEligibility.assertCanBook(userId, session);
      for (const { room } of selected) {
        const held = await this.inventory.holdRoom(room._id, input, { hotelBookingId, holdExpiresAt, now }, session);
        if (!held) throw new ConflictException(`${room.name} is not available for these dates`);
      }
      const [created] = await this.bookings.create([{
        _id: hotelBookingId,
        userId: new Types.ObjectId(userId),
        hotelId: hotel._id,
        hotelName: hotel.name,
        rooms,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        nights,
        totalPrice: rooms.reduce((sum, room) => sum + room.subtotal, 0),
        currency: PLATFORM_CURRENCY,
        status: BookingStatus.PENDING,
        holdExpiresAt,
        policySnapshot: {
          cancellationTiers: hotel.cancellationTiers.map(({ daysBeforeCheckIn, refundPercentage }) => ({ daysBeforeCheckIn, refundPercentage })),
          checkInTime: hotel.checkInTime,
          checkOutTime: hotel.checkOutTime,
        },
      }], { session });
      return created;
    });
    return HotelBookingDto.from(booking);
  }

  /** HTL-17: internal verified-payment callback; never exposed as a client confirmation endpoint. */
  async confirmPaidBooking(hotelBookingId: string, paymentId: string): Promise<void> {
    const _id = toObjectId(hotelBookingId, 'Hotel booking not found');
    const paidId = toObjectId(paymentId, 'Payment not found');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const confirmed = await this.connection.transaction(async (session) => {
          const booking = await this.bookings.findById(_id).session(session).exec();
          if (!booking) throw new NotFoundException('Hotel booking not found');
          // Historical replay must not rebook rooms or depend on later account/provider changes.
          if ([BookingStatus.CONFIRMED, BookingStatus.COMPLETED].includes(booking.status)
            && booking.paymentId?.equals(paidId)) return null;
          const now = new Date();
          if (booking.status !== BookingStatus.PENDING || !booking.holdExpiresAt || booking.holdExpiresAt <= now)
            throw new ConflictException('The hotel booking hold has ended');
          const payment = await this.payments.findOne({ _id: paidId, bookingType: 'hotel', hotelBookingId: _id,
            userId: booking.userId, status: PaymentStatus.SUCCEEDED, currency: booking.currency }).session(session).exec();
          if (!payment || toMinorUnits(payment.amount) !== booking.totalPrice)
            throw new ConflictException('A verified matching payment is required');
          const owner = await this.users.findForEmailVerification(booking.userId.toString(), session);
          if (!owner || owner.status !== AccountStatus.ACTIVE || owner.role !== UserRole.USER
            || !await this.emailEligibility.canBook(booking.userId.toString(), session))
            throw new ConflictException('The booking account is no longer eligible');
          const hotel = await this.inventory.getHotel(booking.hotelId.toString(), session);
          const rooms = await this.inventory.getRooms(booking.rooms.map(room => room.roomId.toString()), session);
          if (!hotel?.isActive || booking.checkIn < this.clock.today() || rooms.length !== booking.rooms.length
            || rooms.some(room => !room.isActive || !room.hotelId.equals(booking.hotelId)))
            throw new ConflictException('The reserved hotel or rooms are no longer available');
          for (const room of booking.rooms) {
            if (!await this.inventory.confirmHeldRoom(room.roomId, _id, booking, now, session))
              throw new ConflictException('The reserved room hold is no longer available');
          }
          booking.status = BookingStatus.CONFIRMED;
          booking.paymentId = paidId;
          booking.bookingReference = 'HTL-' + randomBytes(8).toString('hex').toUpperCase();
          booking.holdExpiresAt = undefined;
          await booking.save({ session });
          return booking;
        });
        if (confirmed) {
          try {
            await this.notifications.notify({ userId: confirmed.userId.toString(), type: 'BOOKING_CONFIRMED',
              message: 'Hotel booking ' + confirmed.bookingReference + ' at ' + confirmed.hotelName
                + ' (' + confirmed.checkIn + ' to ' + confirmed.checkOut + ', ' + confirmed.rooms.length
                + ' rooms) is confirmed. Total paid: ' + (confirmed.totalPrice / 100).toFixed(2) + ' ' + confirmed.currency + '.' });
          } catch { this.logger.error('Could not deliver hotel booking confirmation notification'); }
        }
        return;
      } catch (error) {
        const collision = error as { code?: number; keyPattern?: Record<string, number> };
        if (collision.code !== 11000 || !collision.keyPattern?.bookingReference || attempt === 2) throw error;
      }
    }
  }

  /** PAY-01: a decline leaves the hold untouched; the user may retry until expiry. */
  async markPaymentFailed(_hotelBookingId: string, _paymentId: string): Promise<void> {}

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
   * HTL-18/GEN-11 (contract L3): a PENDING reservation whose hold has ended becomes EXPIRED and its HELD
   * entries are removed from its rooms, in one transaction per reservation. The status condition means a
   * reservation is expired (and released) once, even with several servers. Payment cancellation runs
   * after commit and retries unresolved expired payments on later sweeps. Returns reservations expired.
   */
  async expireOverdueHolds(now: Date = new Date()): Promise<number> {
    const overdue = await this.bookings.find({ status: BookingStatus.PENDING, holdExpiresAt: { $lte: now } })
      .select('_id').limit(SWEEP_BATCH_SIZE).exec();
    let expired = 0;
    for (const { _id } of overdue) {
      const done = await this.connection.transaction(async (session) => {
        const booking = await this.bookings.findOneAndUpdate(
          { _id, status: BookingStatus.PENDING, holdExpiresAt: { $lte: now } },
          { $set: { status: BookingStatus.EXPIRED }, $unset: { holdExpiresAt: 1 } },
          { returnDocument: 'after', session },
        ).exec();
        if (!booking) return false;
        await this.inventory.releaseHolds(booking._id, booking.rooms.map((room) => room.roomId), session);
        return true;
      });
      if (done) expired += 1;
    }
    await this.cancelExpiredPayments();
    return expired;
  }

  /** Recover cancellation failures after expiry committed, including a process restart. */
  private async cancelExpiredPayments(): Promise<void> {
    const pending = await this.payments.aggregate<{ hotelBookingId: Types.ObjectId }>([
      { $match: { bookingType: 'hotel', $or: [
        { status: PaymentStatus.PENDING },
        { status: PaymentStatus.FAILED, failureReason: { $ne: HOLD_EXPIRED_REASON } },
        { status: PaymentStatus.SUCCEEDED, bookingConfirmedAt: null, autoRefundedAt: null },
      ] } },
      { $lookup: { from: this.bookings.collection.name, localField: 'hotelBookingId', foreignField: '_id', as: 'booking' } },
      { $match: { 'booking.status': BookingStatus.EXPIRED } },
      { $sort: { updatedAt: 1, _id: 1 } },
      { $limit: SWEEP_BATCH_SIZE },
      { $project: { hotelBookingId: 1 } },
    ]).exec();
    for (const payment of pending) {
      try {
        await this.bookingPayments.cancelPendingPayment({ bookingType: 'HOTEL', bookingId: payment.hotelBookingId.toString() });
      } catch {
        // The Payment stays unresolved, so the next sweep finds it again. No external call in a transaction.
        this.logger.error('Could not cancel payment for expired hotel reservation; it will be retried');
      }
    }
  }

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
