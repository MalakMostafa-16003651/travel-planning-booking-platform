import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, QueryFilter, Model, Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { CreateFlightBookingDto, PassengerDto } from './dto/create-flight-booking.dto';
import { CancellationQuoteDto, FlightBookingDto, FlightBookingPageDto, FlightBookingSummaryDto, FlightSegmentDto } from './dto/flight-booking-response.dto';
import { FlightBookingGroup } from './dto/list-flight-bookings-query.dto';
import { BOOKING_HOLD_MS, BOOKINGS_PAGE_SIZE, generateBookingReference, passengerFare, passengerTypeOn, PLATFORM_CURRENCY, refundAmountFor, refundPercentageFor, wholeDaysBefore } from './flight-booking.rules';
import { BOOKING_NOTIFICATIONS, BookingNotification, BookingNotificationsPort } from './ports/booking-notifications.port';
import { BOOKING_PAYMENTS, BookingPaymentsPort } from './ports/booking-payments.port';
import { AirlineBookingPolicy, BookableCabin, BookableFlight, FLIGHT_INVENTORY, FlightInventoryPort } from './ports/flight-inventory.port';
import { CancelledBy, FlightBooking, FlightBookingDocument, FlightSegment, Passenger, PassengerType } from './schemas/flight-booking.schema';

const CONFIRM_ATTEMPTS = 3;
const SWEEP_BATCH_SIZE = 100;
const DUPLICATE_KEY = 11000;

interface SelectedSegment {
  flight: BookableFlight;
  cabin: BookableCabin;
  airline: AirlineBookingPolicy;
}

type PricedBooking = Pick<FlightBooking, 'segments' | 'seatCount' | 'baggageFee' | 'totalAmount' | 'currency' | 'lastDepartureAt'> & {
  passengers: Omit<Passenger, '_id'>[];
};

export function assertTraveler(role: UserRole): void {
  if (role !== UserRole.USER) throw new ForbiddenException('Only registered users can book flights');
}

function toObjectId(id: string, message: string): Types.ObjectId {
  if (!/^[0-9a-f]{24}$/i.test(id)) throw new NotFoundException(message);
  return new Types.ObjectId(id);
}

function validationFailure(field: string, message: string): BadRequestException {
  return new BadRequestException({ message: 'Validation failed', errors: { [field]: [message] } });
}

function money(amount: number, currency: string): string {
  return `${(amount / 100).toFixed(2)} ${currency}`;
}

@Injectable()
export class FlightBookingsService {
  private readonly logger = new Logger(FlightBookingsService.name);

  constructor(
    @InjectModel(FlightBooking.name) private readonly bookings: Model<FlightBooking>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(FLIGHT_INVENTORY) private readonly inventory: FlightInventoryPort,
    @Inject(BOOKING_PAYMENTS) private readonly payments: BookingPaymentsPort,
    @Inject(BOOKING_NOTIFICATIONS) private readonly notifications: BookingNotificationsPort,
  ) {}

  /** FLT-19/FLT-21: prices the request without reserving or storing anything. */
  async summarize(input: CreateFlightBookingDto): Promise<FlightBookingSummaryDto> {
    const selected = await this.selectSegments(input);
    const priced = this.price(input.passengers, selected);
    if (selected.some(({ cabin }) => cabin.availableSeats < priced.seatCount)) throw this.notEnoughSeats();
    return {
      segments: priced.segments.map(FlightSegmentDto.from),
      passengers: priced.passengers.map(({ fullName, type, extraBags, extraBaggageWeightKg }) => ({ fullName, type, extraBags, extraBaggageWeightKg })),
      seatCount: priced.seatCount,
      baggageFee: priced.baggageFee,
      totalAmount: priced.totalAmount,
      currency: priced.currency,
    };
  }

  /** FLT-22: seats and booking commit together, so a round trip never half-reserves. */
  async hold(input: CreateFlightBookingDto, userId: string): Promise<FlightBookingDto> {
    const booking = await this.connection.transaction(async (session) => {
      const selected = await this.selectSegments(input, session);
      const priced = this.price(input.passengers, selected);
      for (const { cabin } of selected) {
        if (!await this.inventory.reserveSeats(cabin.cabinId, priced.seatCount, session)) throw this.notEnoughSeats();
      }
      const [created] = await this.bookings.create([{
        ...priced,
        userId: new Types.ObjectId(userId),
        status: BookingStatus.PENDING,
        holdExpiresAt: new Date(Date.now() + BOOKING_HOLD_MS),
      }], { session });
      return created;
    });
    return FlightBookingDto.from(booking);
  }

  async listMine(userId: string, group: FlightBookingGroup | undefined, page = 1): Promise<FlightBookingPageDto> {
    const owner = { userId: new Types.ObjectId(userId) };
    const now = new Date();
    const filters: Record<FlightBookingGroup, QueryFilter<FlightBooking>> = {
      [FlightBookingGroup.UPCOMING]: { ...owner, status: { $in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] }, lastDepartureAt: { $gt: now } },
      [FlightBookingGroup.PAST]: {
        ...owner,
        $or: [{ status: BookingStatus.COMPLETED }, { status: BookingStatus.CONFIRMED, lastDepartureAt: { $lte: now } }],
      },
      [FlightBookingGroup.CANCELLED]: { ...owner, status: { $in: [BookingStatus.CANCELLED, BookingStatus.EXPIRED] } },
    };
    const filter = group ? filters[group] : owner;
    const direction = group === FlightBookingGroup.UPCOMING ? 1 : -1;
    const [items, total] = await Promise.all([
      this.bookings.find(filter).sort({ lastDepartureAt: direction, _id: direction })
        .skip((page - 1) * BOOKINGS_PAGE_SIZE).limit(BOOKINGS_PAGE_SIZE).exec(),
      this.bookings.countDocuments(filter).exec(),
    ]);
    return { items: items.map(FlightBookingDto.from), page, pageSize: BOOKINGS_PAGE_SIZE, total };
  }

  async getMine(flightBookingId: string, userId: string): Promise<FlightBookingDocument> {
    const booking = await this.bookings.findOne({
      _id: toObjectId(flightBookingId, 'Flight booking not found'),
      userId: new Types.ObjectId(userId),
    }).exec();
    if (!booking) throw new NotFoundException('Flight booking not found');
    return booking;
  }

  async getCancellationQuote(flightBookingId: string, userId: string): Promise<CancellationQuoteDto> {
    return this.quoteCancellation(await this.getMine(flightBookingId, userId));
  }

  /** FLT-26. The status check in the write means concurrent cancels release seats once. */
  async cancel(flightBookingId: string, userId: string): Promise<FlightBookingDto> {
    const booking = await this.getMine(flightBookingId, userId);
    const quote = await this.quoteCancellation(booking);
    const cancelled = await this.cancelConfirmed(booking._id, CancelledBy.USER, quote.refundAmount);
    if (!cancelled) throw new ConflictException('Only Confirmed bookings can be cancelled');
    await this.settleRefund(cancelled);
    await this.notifyCancelled(cancelled);
    return FlightBookingDto.from(await this.bookings.findById(cancelled._id).orFail().exec());
  }

  /** E-tickets exist only once payment has been verified (FLT-23). */
  async getTicketableBooking(flightBookingId: string, userId: string): Promise<FlightBookingDocument> {
    const booking = await this.getMine(flightBookingId, userId);
    if (booking.status !== BookingStatus.CONFIRMED && booking.status !== BookingStatus.COMPLETED) {
      throw new ConflictException('An e-ticket is available only for Confirmed bookings');
    }
    return booking;
  }

  // Person 8 (Payments)

  async getPayableBooking(flightBookingId: string, userId: string) {
    const booking = await this.getMine(flightBookingId, userId);
    if (booking.status !== BookingStatus.PENDING || !booking.holdExpiresAt || booking.holdExpiresAt <= new Date()) {
      throw new ConflictException('This booking can no longer be paid');
    }
    return { amount: booking.totalAmount, currency: booking.currency, holdExpiresAt: booking.holdExpiresAt };
  }

  /**
   * FLT-23: call only after the backend has verified the PaymentIntent. Safe to repeat.
   * Throws ConflictException when the hold has ended; the caller must refund that payment.
   */
  async confirmPaidBooking(flightBookingId: string, paymentId: string): Promise<void> {
    const _id = toObjectId(flightBookingId, 'Flight booking not found');
    for (let attempt = 1; ; attempt += 1) {
      try {
        const confirmed = await this.connection.transaction((session) => this.confirmInSession(_id, paymentId, session));
        if (confirmed) {
          await this.notify({
            userId: confirmed.userId.toString(),
            type: 'BOOKING_CONFIRMED',
            message: `Flight booking ${confirmed.bookingReference} is confirmed. Total paid: ${money(confirmed.totalAmount, confirmed.currency)}.`,
          });
        }
        return;
      } catch (error) {
        const referenceCollision = (error as { code?: number }).code === DUPLICATE_KEY;
        if (!referenceCollision || attempt === CONFIRM_ATTEMPTS) throw error;
      }
    }
  }

  // Person 3 (Flights)

  /** FLT-06: full refund for Confirmed bookings; pending holds are released. */
  async cancelBookingsForFlight(flightId: string): Promise<void> {
    const affected = await this.bookings.find({
      'segments.flightId': new Types.ObjectId(flightId),
      status: { $in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
    }).exec();
    for (const booking of affected) {
      if (booking.status === BookingStatus.PENDING) {
        await this.expire(booking._id, {});
        continue;
      }
      const cancelled = await this.cancelConfirmed(booking._id, CancelledBy.AIRLINE, booking.totalAmount);
      if (!cancelled) continue;
      await this.settleRefund(cancelled);
      await this.notifyCancelled(cancelled);
    }
  }

  /** FLT-05: keeps stored schedules current after a time change. */
  async syncFlightSchedule(flightId: string, departureAt: Date, arrivalAt: Date): Promise<void> {
    const _id = new Types.ObjectId(flightId);
    const active = await this.bookings.find({
      'segments.flightId': _id,
      status: { $in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
    }).exec();
    for (const booking of active) {
      for (const segment of booking.segments) {
        if (!segment.flightId.equals(_id)) continue;
        segment.departureAt = departureAt;
        segment.arrivalAt = arrivalAt;
      }
      booking.lastDepartureAt = booking.segments[booking.segments.length - 1].departureAt;
      await booking.save();
    }
  }

  /** FLT-05: who to tell about a schedule change. */
  async findConfirmedUserIdsForFlight(flightId: string): Promise<string[]> {
    const userIds = await this.bookings.distinct('userId', {
      'segments.flightId': new Types.ObjectId(flightId),
      status: BookingStatus.CONFIRMED,
    }).exec();
    return userIds.map(String);
  }

  /** FLT-29: deliberately omits passport/ID numbers and dates of birth. */
  async listBookingsForFlight(flightId: string, page = 1) {
    const _id = new Types.ObjectId(flightId);
    const filter = {
      'segments.flightId': _id,
      status: { $in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED, BookingStatus.CANCELLED] },
    };
    const [items, total] = await Promise.all([
      this.bookings.find(filter).sort({ _id: 1 }).skip((page - 1) * BOOKINGS_PAGE_SIZE).limit(BOOKINGS_PAGE_SIZE).exec(),
      this.bookings.countDocuments(filter).exec(),
    ]);
    return {
      items: items.map((booking) => ({
        flightBookingId: booking._id.toString(),
        bookingReference: booking.bookingReference,
        passengerNames: booking.passengers.map(({ fullName }) => fullName),
        cabinClass: booking.segments.find(({ flightId: id }) => id.equals(_id))?.cabinClass,
        seatCount: booking.seatCount,
        status: booking.status,
      })),
      page,
      pageSize: BOOKINGS_PAGE_SIZE,
      total,
    };
  }

  // Persons 1 and 2 (accounts and administration)

  /** ACC-12: blocks deactivation while a trip is still ahead. */
  async hasUpcomingConfirmedBookings(userId: string): Promise<boolean> {
    const found = await this.bookings.exists({
      userId: new Types.ObjectId(userId),
      status: BookingStatus.CONFIRMED,
      lastDepartureAt: { $gt: new Date() },
    }).exec();
    return found !== null;
  }

  /** ACC-17: read-only view for administrators. */
  async listForAdmin(options: { status?: BookingStatus; from?: Date; to?: Date; page?: number }) {
    const page = options.page ?? 1;
    const filter: QueryFilter<FlightBooking> = {};
    if (options.status) filter.status = options.status;
    if (options.from || options.to) {
      filter['segments.0.departureAt'] = {
        ...(options.from ? { $gte: options.from } : {}),
        ...(options.to ? { $lte: options.to } : {}),
      };
    }
    const [items, total] = await Promise.all([
      this.bookings.find(filter).sort({ _id: -1 }).skip((page - 1) * BOOKINGS_PAGE_SIZE).limit(BOOKINGS_PAGE_SIZE).exec(),
      this.bookings.countDocuments(filter).exec(),
    ]);
    return {
      items: items.map((booking) => ({
        flightBookingId: booking._id.toString(),
        bookingReference: booking.bookingReference,
        userId: booking.userId.toString(),
        airlineId: booking.segments[0].airlineId.toString(),
        departureAt: booking.segments[0].departureAt,
        totalAmount: booking.totalAmount,
        currency: booking.currency,
        status: booking.status,
      })),
      page,
      pageSize: BOOKINGS_PAGE_SIZE,
      total,
    };
  }

  // Scheduled work

  /** FLT-22: payment checks holdExpiresAt itself, so a late sweep cannot extend a hold. */
  async expireOverdueHolds(): Promise<number> {
    const overdue = await this.bookings.find({
      status: BookingStatus.PENDING,
      holdExpiresAt: { $lte: new Date() },
    }).select('_id').limit(SWEEP_BATCH_SIZE).exec();
    for (const { _id } of overdue) await this.expire(_id, { holdExpiresAt: { $lte: new Date() } });
    return overdue.length;
  }

  /** GEN-11: Confirmed becomes Completed once the final segment has departed. */
  async completeDepartedBookings(): Promise<void> {
    await this.bookings.updateMany(
      { status: BookingStatus.CONFIRMED, lastDepartureAt: { $lte: new Date() } },
      { $set: { status: BookingStatus.COMPLETED } },
    ).exec();
  }

  async retryDueRefunds(): Promise<void> {
    const due = await this.bookings.find({ refundDue: true }).limit(SWEEP_BATCH_SIZE).exec();
    for (const booking of due) await this.settleRefund(booking);
  }

  // Internals

  private notEnoughSeats(): ConflictException {
    return new ConflictException('Not enough seats are available on this flight');
  }

  private async selectSegments(input: CreateFlightBookingDto, session?: ClientSession): Promise<SelectedSegment[]> {
    const selected: SelectedSegment[] = [];
    for (const { flightId, cabinId } of input.segments) {
      const flight = await this.inventory.getFlight(flightId, session);
      const cabin = await this.inventory.getCabin(cabinId, session);
      if (!flight || !cabin || cabin.flightId !== flightId) throw new NotFoundException('Flight or cabin not found');
      const airline = await this.inventory.getAirlinePolicy(flight.airlineId, session);
      // FLT-30 and ACC-15: only Scheduled flights of active airlines are bookable.
      if (flight.status !== 'SCHEDULED' || flight.departureAt <= new Date() || !airline?.isActive) {
        throw new ConflictException('This flight is not available for booking');
      }
      selected.push({ flight, cabin, airline });
    }
    const [outbound, inbound] = selected;
    if (inbound) {
      const reversesRoute = inbound.flight.departureAirportId === outbound.flight.arrivalAirportId
        && inbound.flight.arrivalAirportId === outbound.flight.departureAirportId;
      if (!reversesRoute || inbound.flight.departureAt <= outbound.flight.arrivalAt) {
        throw validationFailure('segments', 'The return flight must reverse the outbound route and depart after it arrives');
      }
    }
    return selected;
  }

  private price(passengers: PassengerDto[], selected: SelectedSegment[]): PricedBooking {
    const outboundDeparture = selected[0].flight.departureAt;
    const prepared = passengers.map((passenger) => {
      const dateOfBirth = new Date(passenger.dateOfBirth);
      if (passengerTypeOn(dateOfBirth, outboundDeparture) !== passenger.type) {
        throw validationFailure('passengers', `${passenger.fullName}: passenger type does not match the date of birth`);
      }
      return { ...passenger, dateOfBirth, extraBags: passenger.extraBags ?? 0, extraBaggageWeightKg: passenger.extraBaggageWeightKg ?? 0 };
    });

    const adults = prepared.filter(({ type }) => type === PassengerType.ADULT).length;
    const infants = prepared.filter(({ type }) => type === PassengerType.INFANT).length;
    if (adults === 0) throw validationFailure('passengers', 'A booking needs at least one adult');
    if (infants > adults) throw validationFailure('passengers', 'A booking cannot have more infants than adults');

    const baggageFee = prepared.reduce((fee, passenger) => fee + this.baggageFeeFor(passenger, selected), 0);
    const fares = selected.reduce((sum, { cabin }) => (
      sum + prepared.reduce((subtotal, { type }) => subtotal + passengerFare(cabin.price, type), 0)
    ), 0);

    const segments: FlightSegment[] = selected.map(({ flight, cabin }) => ({
      flightId: new Types.ObjectId(flight.flightId),
      airlineId: new Types.ObjectId(flight.airlineId),
      cabinId: new Types.ObjectId(cabin.cabinId),
      cabinClass: cabin.cabinClass,
      fare: cabin.price,
      flightNumber: flight.flightNumber,
      departureAirportCode: flight.departureAirportCode,
      arrivalAirportCode: flight.arrivalAirportCode,
      departureAt: flight.departureAt,
      arrivalAt: flight.arrivalAt,
      departureTimeZone: flight.departureTimeZone,
      arrivalTimeZone: flight.arrivalTimeZone,
    }));

    return {
      segments,
      passengers: prepared,
      seatCount: prepared.length - infants,
      baggageFee,
      totalAmount: fares + baggageFee,
      currency: PLATFORM_CURRENCY,
      lastDepartureAt: segments[segments.length - 1].departureAt,
    };
  }

  /** FLT-08/FLT-19: limits and fees apply per segment, as each airline sets its own rule. */
  private baggageFeeFor(passenger: { fullName: string; extraBags: number; extraBaggageWeightKg: number }, selected: SelectedSegment[]): number {
    const { fullName, extraBags, extraBaggageWeightKg } = passenger;
    if (extraBags === 0) {
      if (extraBaggageWeightKg > 0) throw validationFailure('passengers', `${fullName}: extra baggage weight needs at least one extra bag`);
      return 0;
    }
    if (extraBaggageWeightKg === 0) throw validationFailure('passengers', `${fullName}: enter the weight of the extra bags`);
    return selected.reduce((fee, { airline, cabin }) => {
      if (extraBags > airline.maxExtraBagsPerPassenger) {
        throw validationFailure('passengers', `${fullName}: at most ${airline.maxExtraBagsPerPassenger} extra bags are allowed`);
      }
      if (extraBaggageWeightKg > extraBags * cabin.baggageMaxWeightKg) {
        throw validationFailure('passengers', `${fullName}: each extra bag can weigh at most ${cabin.baggageMaxWeightKg} kg`);
      }
      return fee + extraBags * airline.pricePerExtraBag;
    }, 0);
  }

  private async confirmInSession(_id: Types.ObjectId, paymentId: string, session: ClientSession): Promise<FlightBookingDocument | null> {
    const existing = await this.bookings.findById(_id).session(session).exec();
    if (!existing) throw new NotFoundException('Flight booking not found');
    if (existing.status === BookingStatus.CONFIRMED && existing.paymentId?.toString() === paymentId) return null;
    const confirmed = await this.bookings.findOneAndUpdate(
      { _id, status: BookingStatus.PENDING, holdExpiresAt: { $gt: new Date() } },
      {
        $set: { status: BookingStatus.CONFIRMED, bookingReference: generateBookingReference(), paymentId: new Types.ObjectId(paymentId) },
        $unset: { holdExpiresAt: 1 },
      },
      { returnDocument: 'after', session },
    ).exec();
    if (!confirmed) throw new ConflictException('The hold on this booking has ended');
    for (const { cabinId } of confirmed.segments) {
      if (!await this.inventory.convertHeldToBooked(cabinId.toString(), confirmed.seatCount, session)) {
        throw new ConflictException('Held seats could not be confirmed');
      }
    }
    return confirmed;
  }

  private async quoteCancellation(booking: FlightBookingDocument): Promise<CancellationQuoteDto> {
    if (booking.status !== BookingStatus.CONFIRMED) throw new ConflictException('Only Confirmed bookings can be cancelled');
    const outbound = booking.segments[0];
    const flight = await this.inventory.getFlight(outbound.flightId.toString());
    const departureAt = flight?.departureAt ?? outbound.departureAt;
    const now = new Date();
    if (departureAt <= now) throw new ConflictException('A booking cannot be cancelled after departure');
    const airline = await this.inventory.getAirlinePolicy(outbound.airlineId.toString());
    const daysBeforeDeparture = wholeDaysBefore(departureAt, now);
    const refundPercentage = refundPercentageFor(airline?.cancellationTiers ?? [], daysBeforeDeparture);
    return {
      flightBookingId: booking._id.toString(),
      daysBeforeDeparture,
      refundPercentage,
      refundAmount: refundAmountFor(booking.totalAmount, refundPercentage),
      totalAmount: booking.totalAmount,
      currency: booking.currency,
    };
  }

  private cancelConfirmed(_id: Types.ObjectId, cancelledBy: CancelledBy, refundAmount: number): Promise<FlightBookingDocument | null> {
    return this.connection.transaction(async (session) => {
      const cancelled = await this.bookings.findOneAndUpdate(
        { _id, status: BookingStatus.CONFIRMED },
        { $set: { status: BookingStatus.CANCELLED, cancelledAt: new Date(), cancelledBy, refundAmount, refundDue: refundAmount > 0 } },
        { returnDocument: 'after', session },
      ).exec();
      if (!cancelled) return null;
      for (const { cabinId } of cancelled.segments) {
        await this.inventory.releaseBookedSeats(cabinId.toString(), cancelled.seatCount, session);
      }
      return cancelled;
    });
  }

  private async expire(_id: Types.ObjectId, condition: QueryFilter<FlightBooking>): Promise<void> {
    const expired = await this.connection.transaction(async (session) => {
      const booking = await this.bookings.findOneAndUpdate(
        { _id, status: BookingStatus.PENDING, ...condition },
        { $set: { status: BookingStatus.EXPIRED }, $unset: { holdExpiresAt: 1 } },
        { returnDocument: 'after', session },
      ).exec();
      if (!booking) return null;
      for (const { cabinId } of booking.segments) {
        await this.inventory.releaseHeldSeats(cabinId.toString(), booking.seatCount, session);
      }
      return booking;
    });
    if (!expired) return;
    try {
      await this.payments.cancelPendingPayment({ bookingType: 'FLIGHT', bookingId: _id.toString() });
    } catch {
      // A late success is rejected by confirmPaidBooking, and the caller then refunds it.
      this.logger.error(`Could not cancel the payment for expired booking ${_id.toString()}`);
    }
  }

  /** Runs after commit: an external call must not sit inside a database transaction. */
  private async settleRefund(booking: FlightBookingDocument): Promise<void> {
    if (!booking.refundDue || !booking.refundAmount) return;
    try {
      const { refundId } = await this.payments.createRefund({
        bookingType: 'FLIGHT',
        bookingId: booking._id.toString(),
        amount: booking.refundAmount,
        reason: booking.cancelledBy === CancelledBy.AIRLINE ? 'Flight cancelled by the airline' : 'Booking cancelled by the user',
      });
      await this.bookings.updateOne({ _id: booking._id }, { $set: { refundDue: false, refundId: new Types.ObjectId(refundId) } }).exec();
    } catch {
      // refundDue stays true, so retryDueRefunds tries again.
      this.logger.error(`Refund request failed for booking ${booking._id.toString()}`);
    }
  }

  private notifyCancelled(booking: FlightBookingDocument): Promise<void> {
    const refund = booking.refundAmount ? ` Refund: ${money(booking.refundAmount, booking.currency)}.` : '';
    return this.notify({
      userId: booking.userId.toString(),
      type: 'BOOKING_CANCELLED',
      message: `Flight booking ${booking.bookingReference} was cancelled.${refund}`,
    });
  }

  /** A failed notification must not undo a booking change that has already committed. */
  private async notify(notification: BookingNotification): Promise<void> {
    try {
      await this.notifications.notify(notification);
    } catch {
      this.logger.error(`Could not deliver a ${notification.type} notification`);
    }
  }
}
