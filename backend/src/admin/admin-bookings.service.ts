import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Airline, AirlineDocument } from '../airlines/schemas/airline.schema';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { AdminBookingPageDto } from './dto/admin-booking-response.dto';
import { ListAdminBookingsQueryDto } from './dto/list-admin-bookings-query.dto';

@Injectable()
export class AdminBookingsService {
  constructor(
    // Person 4's read-only ACC-17 query, reused rather than duplicated.
    private readonly flightBookings: FlightBookingsService,
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

    if (query.type === 'HOTEL') {
      // Person 6's hotel-booking module is not merged yet; this mirrors HTL-22's pending 503.
      throw new ServiceUnavailableException('Hotel bookings are not available yet');
    }

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
}

function unique(ids: string[]): Types.ObjectId[] {
  return [...new Set(ids)].filter((id) => /^[a-f\d]{24}$/i.test(id)).map((id) => new Types.ObjectId(id));
}
