import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Airline, AirlineDocument } from '../airlines/schemas/airline.schema';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { AdminBookingDto, AdminBookingPageDto } from './dto/admin-booking-response.dto';
import { ListAdminBookingsQueryDto } from './dto/list-admin-bookings-query.dto';

/** GEN-05: every list uses page size 10 (the same as both owners' lists). */
const PAGE_SIZE = 10;

/** Reads one owner's newest-first pages lazily, one item at a time. */
class PagedSource {
  private buffer: AdminBookingDto[] = [];
  private nextPage = 1;
  private finished = false;
  private knownTotal: number | undefined;

  constructor(private readonly load: (page: number) => Promise<AdminBookingPageDto>) {}

  async peek(): Promise<AdminBookingDto | undefined> {
    if (this.buffer.length === 0 && !this.finished) {
      const result = await this.load(this.nextPage++);
      this.knownTotal = result.total;
      this.buffer = result.items;
      if (result.items.length < result.pageSize) this.finished = true;
    }
    return this.buffer[0];
  }

  take(): AdminBookingDto {
    return this.buffer.shift()!;
  }

  async total(): Promise<number> {
    if (this.knownTotal === undefined) await this.peek();
    return this.knownTotal ?? 0;
  }
}

@Injectable()
export class AdminBookingsService {
  constructor(
    // Person 4's read-only ACC-17 query, reused rather than duplicated.
    private readonly flightBookings: FlightBookingsService,
    // Person 6's read-only ACC-17 query for hotel reservations.
    private readonly hotelBookings: HotelBookingsService,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Airline.name) private readonly airlines: Model<AirlineDocument>,
  ) {}

  /** ACC-17: read-only list of bookings with reference, user, provider, dates, amount and status. */
  async list(query: ListAdminBookingsQueryDto): Promise<AdminBookingPageDto> {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    // A calendar date includes that whole UTC day; timestamps retain their exact boundary.
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(query.to!)) to.setUTCHours(23, 59, 59, 999);
    const errors: Record<string, string[]> = {};
    if (from && !Number.isFinite(from.getTime())) errors.from = ['From must be a supported ISO 8601 date'];
    if (to && !Number.isFinite(to.getTime())) errors.to = ['To must be a supported ISO 8601 date'];
    if (from && to && Number.isFinite(from.getTime()) && Number.isFinite(to.getTime()) && from > to) errors.from = ['From must not be after To'];
    if (Object.keys(errors).length > 0) throw new BadRequestException({ message: 'Validation failed', errors });

    const page = query.page ?? 1;
    if (query.type === 'FLIGHT') return this.listFlight(query, from, to, page);
    if (query.type === 'HOTEL') return this.listHotel(query, from, to, page);
    return this.listCombined(query, from, to, page);
  }

  /**
   * ACC-17 with no type: flights and hotels together, newest booking first, one combined total
   * and 10 per page. Both owners' lists are already sorted newest first (by _id), so their pages
   * are merged in order and only as many pages as needed are read.
   */
  private async listCombined(query: ListAdminBookingsQueryDto, from: Date | undefined, to: Date | undefined, page: number): Promise<AdminBookingPageDto> {
    const flights = new PagedSource((n) => this.listFlight(query, from, to, n));
    const hotels = new PagedSource((n) => this.listHotel(query, from, to, n));
    const first = page * PAGE_SIZE;
    const merged: AdminBookingDto[] = [];
    while (merged.length < first) {
      const [nextFlight, nextHotel] = await Promise.all([flights.peek(), hotels.peek()]);
      if (!nextFlight && !nextHotel) break;
      // ObjectId hex strings of equal length compare in creation order.
      const takeFlight = nextFlight && (!nextHotel || nextFlight.bookingId > nextHotel.bookingId);
      merged.push(takeFlight ? flights.take() : hotels.take());
    }
    return {
      items: merged.slice((page - 1) * PAGE_SIZE, first),
      page,
      pageSize: PAGE_SIZE,
      total: (await flights.total()) + (await hotels.total()),
    };
  }

  /** ACC-17 for flights, through Person 4's listForAdmin. */
  private async listFlight(query: ListAdminBookingsQueryDto, from: Date | undefined, to: Date | undefined, page: number): Promise<AdminBookingPageDto> {
    const result = await this.flightBookings.listForAdmin({ status: query.status, from, to, page });
    const [names, airlines] = await Promise.all([
      this.users.find({ _id: { $in: unique(result.items.map((item) => item.userId)) } }, { name: 1, email: 1 }).lean().exec(),
      this.airlines.find({ _id: { $in: unique(result.items.map((item) => item.airlineId)) } }, { name: 1 }).lean().exec(),
    ]);
    const userById = new Map(names.map((user) => [user._id.toString(), user]));
    const airlineById = new Map(airlines.map((airline) => [airline._id.toString(), airline.name]));

    return {
      items: result.items.map((item) => ({
        type: 'FLIGHT' as const,
        bookingId: item.flightBookingId,
        bookingReference: item.bookingReference,
        userId: item.userId,
        userName: userById.get(item.userId)?.name,
        userEmail: userById.get(item.userId)?.email,
        providerId: item.airlineId,
        providerName: airlineById.get(item.airlineId),
        startDate: item.departureAt,
        totalAmount: item.totalAmount,
        currency: item.currency,
        status: item.status,
      })),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    };
  }

  /**
   * ACC-17 for hotels. Person 6's listForAdmin filters on the check-in calendar date and
   * accepts YYYY-MM-DD only, so ISO date-times are reduced to their UTC date first.
   */
  private async listHotel(query: ListAdminBookingsQueryDto, from: Date | undefined, to: Date | undefined, page: number): Promise<AdminBookingPageDto> {
    const result = await this.hotelBookings.listForAdmin({
      status: query.status,
      from: from ? toDateOnly(from) : undefined,
      to: to ? toDateOnly(to) : undefined,
      page,
    });
    const users = await this.users.find({ _id: { $in: unique(result.items.map((item) => item.userId)) } }, { name: 1, email: 1 }).lean().exec();
    const userById = new Map(users.map((user) => [user._id.toString(), user]));
    return {
      items: result.items.map((item) => ({
        type: 'HOTEL' as const,
        bookingId: item.hotelBookingId,
        bookingReference: item.bookingReference ?? undefined,
        userId: item.userId,
        userName: userById.get(item.userId)?.name,
        userEmail: userById.get(item.userId)?.email,
        providerId: item.hotelId,
        providerName: item.hotelName,
        startDate: new Date(`${item.checkIn}T00:00:00.000Z`),
        endDate: new Date(`${item.checkOut}T00:00:00.000Z`),
        totalAmount: item.totalPrice,
        currency: item.currency,
        status: item.status,
      })),
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    };
  }
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function unique(ids: string[]): Types.ObjectId[] {
  return [...new Set(ids)].filter((id) => /^[a-f\d]{24}$/i.test(id)).map((id) => new Types.ObjectId(id));
}
