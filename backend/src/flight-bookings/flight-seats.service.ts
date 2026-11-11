import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { UsersService } from '../users/users.service';
import { FlightSeatMapDto, SelectFlightSeatsDto } from './dto/select-flight-seats.dto';
import { FlightSeatAssignmentsService } from './flight-seat-assignments.service';
import { FLIGHT_INVENTORY, FlightInventoryPort } from './ports/flight-inventory.port';
import { FlightBooking, FlightBookingDocument, PassengerType } from './schemas/flight-booking.schema';

@Injectable()
export class FlightSeatsService {
  constructor(@InjectModel(FlightBooking.name) private readonly bookings: Model<FlightBooking>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(FLIGHT_INVENTORY) private readonly inventory: FlightInventoryPort,
    private readonly users: UsersService, private readonly seats: FlightSeatAssignmentsService) {}

  private async owned(id: string, userId: string, session?: ClientSession): Promise<FlightBookingDocument> {
    if (!/^[a-f0-9]{24}$/i.test(id)) throw new NotFoundException('Flight booking not found');
    const row = await this.bookings.findOne({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) }).session(session ?? null).exec();
    if (!row) throw new NotFoundException('Flight booking not found');
    return row;
  }
  private eligible(booking: FlightBookingDocument): void {
    if (booking.status !== BookingStatus.CONFIRMED && (booking.status !== BookingStatus.PENDING || !booking.holdExpiresAt || booking.holdExpiresAt <= new Date())) {
      throw new ConflictException('Seats can be selected only for an unexpired hold or Confirmed booking');
    }
  }
  private async capacity(cabinId: string, flightId: string, session?: ClientSession): Promise<number> {
    const cabin = await this.inventory.getCabin(cabinId, session);
    if (!cabin || cabin.flightId.toLowerCase() !== flightId.toLowerCase() || !Number.isSafeInteger(cabin.totalSeats) || cabin.totalSeats! < 1) throw new ConflictException('Cabin seat capacity is unavailable');
    return cabin.totalSeats!;
  }
  async map(id: string, userId: string): Promise<FlightSeatMapDto> {
    const booking = await this.owned(id, userId);
    this.eligible(booking);
    return this.mapBooking(booking);
  }
  private async mapBooking(booking: FlightBookingDocument, session?: ClientSession): Promise<FlightSeatMapDto> {
    const segments = [];
    for (const segment of booking.segments) {
      const flightId = segment.flightId.toString(), cabinId = segment.cabinId.toString();
      const flight = await this.inventory.getFlight(flightId, session);
      segments.push({ flightId, cabinId, capacity: await this.capacity(cabinId, flightId, session),
        modifiable: flight?.status === 'SCHEDULED' && flight.departureAt > new Date(),
        occupiedSeatNumbers: await this.seats.occupied(cabinId, session) });
    }
    return { flightBookingId: booking._id.toString(), segments, selections: await this.seats.list(booking._id.toString(), session) };
  }
  async select(id: string, userId: string, input: SelectFlightSeatsDto): Promise<FlightSeatMapDto> {
    try {
      return await this.connection.transaction(async (session) => {
        const booking = await this.owned(id, userId, session);
        this.eligible(booking);
        await this.users.acquireBookingGate(userId, session);
        const future: typeof booking.segments = [];
        const departureTimes: Date[] = [];
        // Use live departure times: schedule propagation to booking snapshots can be retried later.
        // Same Flight writes serialize seat assignment with cabin capacity edits/cancellation.
        for (const segment of [...booking.segments].sort((a, b) => a.flightId.toString().localeCompare(b.flightId.toString()))) {
          const current = await this.inventory.getFlight(segment.flightId.toString(), session);
          if (!current) throw new ConflictException('Flight is no longer available for seat selection');
          if (current.departureAt <= new Date()) continue;
          const flight = await this.inventory.acquireBookingGate(segment.flightId.toString(), session);
          if (!flight || flight.status !== 'SCHEDULED' || flight.departureAt <= new Date()) throw new ConflictException('Flight is no longer available for seat selection');
          future.push(segment);
          departureTimes.push(flight.departureAt);
        }
        if (!future.length) throw new ConflictException('Seats cannot be changed after departure');
        const pairs = new Set<string>(), numbers = new Set<string>();
        const rows = [];
        for (const selection of input.selections) {
          const segment = future.find(row => row.flightId.toString() === selection.flightId.toLowerCase());
          const passenger = booking.passengers.find(row => row._id.toString() === selection.passengerId.toLowerCase());
          if (!segment || !passenger || passenger.type === PassengerType.INFANT) throw new BadRequestException('Choose a seat for an adult/child on a future segment of your booking');
          const capacity = await this.capacity(segment.cabinId.toString(), segment.flightId.toString(), session);
          if (!Number.isSafeInteger(selection.seatNumber) || selection.seatNumber < 1 || selection.seatNumber > capacity) throw new BadRequestException('Seat number exceeds the cabin capacity');
          const pair = segment.flightId.toString() + ':' + passenger._id.toString();
          const number = segment.flightId.toString() + ':' + selection.seatNumber;
          if (pairs.has(pair) || numbers.has(number)) throw new BadRequestException('Each passenger and seat may appear only once per segment');
          pairs.add(pair); numbers.add(number);
          rows.push({ userId: booking.userId, flightBookingId: booking._id, flightId: segment.flightId,
            cabinId: segment.cabinId, passengerId: passenger._id, seatNumber: selection.seatNumber,
            ...(booking.status === BookingStatus.PENDING ? { expiresAt: booking.holdExpiresAt } : {}) });
        }
        const flightIds = future.map(segment => segment.flightId);
        await this.seats.assignments.deleteMany({ cabinId: { $in: future.map(segment => segment.cabinId) }, expiresAt: { $lte: new Date() } }, { session }).exec();
        await this.seats.assignments.deleteMany({ flightBookingId: booking._id, flightId: { $in: flightIds } }, { session }).exec();
        if (rows.length) await this.seats.assignments.insertMany(rows, { session, ordered: true });
        const deadlines = departureTimes.map(date => ({ $gt: [{ $literal: date }, '$$NOW'] }));
        const touched = await this.bookings.updateOne({ _id: booking._id, status: booking.status,
          $expr: { $and: [...deadlines, ...(booking.status === BookingStatus.PENDING ? [{ $gt: ['$holdExpiresAt', '$$NOW'] }] : [])] } },
          { $set: { updatedAt: new Date() } }, { session }).exec();
        if (touched.matchedCount !== 1) throw new ConflictException('Booking changed or expired before seats could be selected');
        return this.mapBooking(booking, session);
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new ConflictException('A selected seat is no longer available');
      throw error;
    }
  }
}
