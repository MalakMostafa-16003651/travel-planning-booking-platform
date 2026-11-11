import { advanceBookingVersion, incrementableVersion } from '../../common/booking-gate';
import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection, Types } from 'mongoose';
import { AirlineBookingPolicy, BookableCabin, BookableFlight, FlightInventoryPort } from '../ports/flight-inventory.port';

type Stored = Record<string, any>;

/**
 * Works on the collections agreed with Person 3 without defining their schemas.
 * Every seat change is one conditional document write, so counts cannot oversell
 * or go negative however requests interleave.
 */
@Injectable()
export class MongoFlightInventoryAdapter implements FlightInventoryPort {
  private readonly logger = new Logger(MongoFlightInventoryAdapter.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  private collection(name: string) {
    return this.connection.collection<Stored>(name);
  }

  async acquireBookingGate(flightId: string, session: ClientSession): Promise<BookableFlight | null> {
    const result = await this.collection('flights').updateOne(
      { _id: new Types.ObjectId(flightId), $expr: incrementableVersion('bookingVersion') },
      advanceBookingVersion(), { session },
    );
    return result.modifiedCount === 1 ? this.getFlight(flightId, session) : null;
  }

  async getFlight(flightId: string, session?: ClientSession): Promise<BookableFlight | null> {
    const flight = await this.collection('flights').findOne({ _id: new Types.ObjectId(flightId) }, { session });
    if (!flight) return null;
    const departure = await this.collection('airports').findOne({ _id: flight.departureAirportId }, { session });
    const arrival = await this.collection('airports').findOne({ _id: flight.arrivalAirportId }, { session });
    if (!departure || !arrival) return null;
    return {
      flightId,
      airlineId: flight.airlineId.toString(),
      flightNumber: flight.flightNumber,
      status: flight.status,
      departureAt: flight.departureAt,
      arrivalAt: flight.arrivalAt,
      departureAirportId: flight.departureAirportId.toString(),
      arrivalAirportId: flight.arrivalAirportId.toString(),
      departureAirportCode: departure.code,
      arrivalAirportCode: arrival.code,
      departureTimeZone: departure.timeZone,
      arrivalTimeZone: arrival.timeZone,
    };
  }

  async getCabin(cabinId: string, session?: ClientSession): Promise<BookableCabin | null> {
    const cabin = await this.collection('cabininventories').findOne({ _id: new Types.ObjectId(cabinId) }, { session });
    if (!cabin) return null;
    return {
      cabinId,
      flightId: cabin.flightId.toString(),
      cabinClass: cabin.cabinClass,
      price: cabin.price,
      baggageMaxWeightKg: cabin.baggageMaxWeightKg,
      baggageAllowanceCount: cabin.baggageAllowanceCount ?? 0,
      totalSeats: cabin.totalSeats,
      availableSeats: cabin.totalSeats - cabin.bookedSeats - cabin.heldSeats,
    };
  }

  async acquireAirlineBookingGate(airlineId: string, session: ClientSession): Promise<AirlineBookingPolicy | null> {
    const result = await this.collection('airlines').updateOne(
      { _id: new Types.ObjectId(airlineId), isActive: true, $expr: incrementableVersion('bookingVersion') },
      advanceBookingVersion(), { session },
    );
    return result.modifiedCount === 1 ? this.getAirlinePolicy(airlineId, session) : null;
  }

  async getAirlinePolicy(airlineId: string, session?: ClientSession): Promise<AirlineBookingPolicy | null> {
    const airline = await this.collection('airlines').findOne({ _id: new Types.ObjectId(airlineId) }, { session });
    if (!airline) return null;
    return {
      airlineId,
      isActive: airline.isActive === true,
      pricePerExtraBag: airline.baggagePolicy?.pricePerExtraBag ?? 0,
      maxExtraBagsPerPassenger: airline.baggagePolicy?.maxExtraBagsPerPassenger ?? 0,
      cancellationTiers: airline.cancellationTiers ?? [],
    };
  }

  reserveSeats(cabinId: string, seats: number, session: ClientSession): Promise<boolean> {
    const available = { $subtract: ['$totalSeats', { $add: ['$bookedSeats', '$heldSeats'] }] };
    return this.adjust({ _id: new Types.ObjectId(cabinId), $expr: { $gte: [available, seats] } }, { heldSeats: seats }, session);
  }

  convertHeldToBooked(cabinId: string, seats: number, session: ClientSession): Promise<boolean> {
    return this.adjust(
      { _id: new Types.ObjectId(cabinId), heldSeats: { $gte: seats } },
      { heldSeats: -seats, bookedSeats: seats },
      session,
    );
  }

  releaseHeldSeats(cabinId: string, seats: number, session: ClientSession): Promise<boolean> {
    return this.release('heldSeats', cabinId, seats, session);
  }

  releaseBookedSeats(cabinId: string, seats: number, session: ClientSession): Promise<boolean> {
    return this.release('bookedSeats', cabinId, seats, session);
  }

  private async release(field: 'heldSeats' | 'bookedSeats', cabinId: string, seats: number, session: ClientSession) {
    const released = await this.adjust(
      { _id: new Types.ObjectId(cabinId), [field]: { $gte: seats } },
      { [field]: -seats },
      session,
    );
    if (!released) this.logger.warn(`Cabin ${cabinId} could not release ${seats} ${field}`);
    return released;
  }

  private async adjust(filter: Stored, increments: Record<string, number>, session: ClientSession): Promise<boolean> {
    const result = await this.collection('cabininventories').updateOne(filter, { $inc: increments }, { session });
    return result.modifiedCount === 1;
  }
}
