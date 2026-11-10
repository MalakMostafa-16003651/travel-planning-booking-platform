import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Airline, AirlineDocument } from '../airlines/schemas/airline.schema';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { AdminBookingPageDto } from './dto/admin-booking-response.dto';
import { ListAdminBookingsQueryDto } from './dto/list-admin-bookings-query.dto';

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
    const errors: Record<string, string[]> = {};
    if (from && !Number.isFinite(from.getTime())) errors.from = ['From must be a supported ISO 8601 date'];
    if (to && !Number.isFinite(to.getTime())) errors.to = ['To must be a supported ISO 8601 date'];
    if (from && to && Number.isFinite(from.getTime()) && Number.isFinite(to.getTime()) && from > to) errors.from = ['From must not be after To'];
    if (Object.keys(errors).length > 0) throw new BadRequestException({ message: 'Validation failed', errors });

    if (query.type === 'HOTEL') return this.listHotel(query, from, to);

    const result = await this.flightBookings.listForAdmin({ status: query.status, from, to, page: query.page ?? 1 });
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
  private async listHotel(query: ListAdminBookingsQueryDto, from?: Date, to?: Date): Promise<AdminBookingPageDto> {
    const result = await this.hotelBookings.listForAdmin({
      status: query.status,
      from: from ? toDateOnly(from) : undefined,
      to: to ? toDateOnly(to) : undefined,
      page: query.page ?? 1,
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
