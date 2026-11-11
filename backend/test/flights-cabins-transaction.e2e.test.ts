import { FlightSeatAssignmentsService } from '../src/flight-bookings/flight-seat-assignments.service';
import { FlightSeatAssignment, FlightSeatAssignmentSchema } from '../src/flight-bookings/schemas/flight-seat-assignment.schema';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types, createConnection } from 'mongoose';
import { AirlinesService } from '../src/airlines/airlines.service';
import {Airline,AirlineSchema,} from '../src/airlines/schemas/airline.schema';
import {Airport,AirportSchema,} from '../src/airports/schemas/airport.schema';
import { FlightStatus } from '../src/common/enums/flight-status.enum';
import { FlightsService } from '../src/flights/flights.service';
import { FlightBookingsService } from '../src/flight-bookings/flight-bookings.service';
import {CabinClass,CabinInventory,CabinInventorySchema,} from '../src/flights/schemas/cabin-inventory.schema';
import { Flight, FlightSchema } from '../src/flights/schemas/flight.schema';
import { NotificationsService } from '../src/notifications/notifications.service';

describe('FlightsService - cabin transaction', () => {
  let replicaSet: MongoMemoryReplSet;
  let connection: Connection;

  let flights: Model<Flight>;
  let cabins: Model<CabinInventory>;
  let airports: Model<Airport>;
  let airlinesModel: Model<Airline>;

  let service: FlightsService;

  const airlineId = new Types.ObjectId();
  const moderatorId = new Types.ObjectId().toString();

  before(async () => {
    replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      binary: {
        downloadDir: process.cwd() + '/node_modules/.cache/mongodb-binaries',
      },
    });

    connection = await createConnection(
      replicaSet.getUri('flight-cabin-transaction'),
    ).asPromise();

    flights = connection.model<Flight>(Flight.name, FlightSchema);
    cabins = connection.model<CabinInventory>(
      CabinInventory.name,
      CabinInventorySchema,
    );
    airports = connection.model<Airport>(Airport.name, AirportSchema);
    airlinesModel = connection.model<Airline>(Airline.name, AirlineSchema);

    const airlinesService = {
      getAssignedAirlineId: async () => airlineId,
    } as unknown as AirlinesService;
    const bookingsService = {} as FlightBookingsService;
    const notificationsService = {
     notifyMany: async () => undefined,
     } as unknown as NotificationsService;
    service = new FlightsService(
      connection,
      flights,
      cabins,
      airports,
      airlinesModel,
      airlinesService,
      bookingsService,
      notificationsService,
      new FlightSeatAssignmentsService(connection.model(FlightSeatAssignment.name, FlightSeatAssignmentSchema)),

    );

    await Promise.all([flights.init(), cabins.init()]);
  }, { timeout: 30 * 60_000 });

  after(async () => {
    if (connection) {
      await connection.close();
    }

    if (replicaSet) {
      await replicaSet.stop();
    }
  });

  it('rolls back the entire cabin batch when one cabin already exists', async () => {
    const departureAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const arrivalAt = new Date(departureAt.getTime() + 3 * 60 * 60 * 1000);

    const flight = await flights.create({
      airlineId,
      flightNumber: 'CAI123',
      status: FlightStatus.SCHEDULED,
      departureAt,
      arrivalAt,
      departureAirportId: new Types.ObjectId(),
      arrivalAirportId: new Types.ObjectId(),
      departureLocalDate: departureAt.toISOString().slice(0, 10),
    });

    await cabins.create({
      flightId: flight._id,
      cabinClass: CabinClass.ECONOMY,
      totalSeats: 50,
      bookedSeats: 0,
      heldSeats: 0,
      price: 10000,
      baggageAllowanceCount: 1,
      baggageMaxWeightKg: 23,
    });

    await assert.rejects(
      service.createCabins(moderatorId, flight._id.toString(), {
        cabins: [
          {
            cabinClass: CabinClass.BUSINESS,
            totalSeats: 20,
            price: 20000,
            baggageAllowanceCount: 2,
            baggageMaxWeightKg: 32,
          },
          {
            cabinClass: CabinClass.ECONOMY,
            totalSeats: 50,
            price: 10000,
            baggageAllowanceCount: 1,
            baggageMaxWeightKg: 23,
          },
        ],
      }),
      (error: unknown) => error instanceof ConflictException,
    );

    const savedCabins = await cabins.find({
      flightId: flight._id,
    }).exec();

    assert.equal(savedCabins.length, 1);

    assert.equal(
      savedCabins[0].cabinClass,
      CabinClass.ECONOMY,
    );

    assert.equal(
      savedCabins.some(
        (cabin) => cabin.cabinClass === CabinClass.BUSINESS,
      ),
      false,
    );
  });
});