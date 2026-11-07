import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';

import { configureApplication } from '../src/configure-application';
import { FlightsModule } from '../src/flights/flights.module';
import { FlightStatus } from '../src/common/enums/flight-status.enum';

// All searches use this future date.
const SEARCH_DATE = '2027-12-10';

const BASE_QUERY = {
  departureAirportCode: 'CAI',
  arrivalAirportCode: 'DXB',
  departureDate: SEARCH_DATE,
  roundTrip: 'false',
  adults: '1',
  children: '0',
  infants: '0',
};

describe('Flight search (e2e)', { concurrency: false }, () => {
  let replicaSet: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;

  let cairoId: Types.ObjectId;
  let dubaiId: Types.ObjectId;
  let airlineId: Types.ObjectId;

  async function seedFlight(options: {
    flightNumber: string;
    departureHour: number;
    durationHours: number;
    price: number;
    totalSeats?: number;
    bookedSeats?: number;
    heldSeats?: number;
  }) {
    const departureAt = new Date(
      Date.UTC(2027, 11, 10, options.departureHour, 0, 0),
    );

    const arrivalAt = new Date(
      departureAt.getTime() + options.durationHours * 60 * 60 * 1000,
    );

    const flightId = new Types.ObjectId();

    await connection.collection('flights').insertOne({
      _id: flightId,
      airlineId,
      flightNumber: options.flightNumber,
      status: FlightStatus.SCHEDULED,
      departureAt,
      arrivalAt,
      departureAirportId: cairoId,
      arrivalAirportId: dubaiId,
      departureLocalDate: SEARCH_DATE,
    });

    await connection.collection('cabininventories').insertOne({
      _id: new Types.ObjectId(),
      flightId,
      cabinClass: 'ECONOMY',
      totalSeats: options.totalSeats ?? 10,
      bookedSeats: options.bookedSeats ?? 0,
      heldSeats: options.heldSeats ?? 0,
      price: options.price,
      baggageAllowanceCount: 1,
      baggageMaxWeightKg: 23,
    });

    return flightId.toString();
  }

  async function search(query = {}) {
    return request(app.getHttpServer())
      .get('/api/flights/search')
      .query({
        ...BASE_QUERY,
        ...query,
      });
  }

  before(async () => {
    replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          skipProcessEnv: true,
          load: [
            () => ({
              JWT_SECRET: randomBytes(48).toString('hex'),
            }),
          ],
        }),
        MongooseModule.forRoot(
          replicaSet.getUri('flight-search-test'),
        ),
        FlightsModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);

    await app.init();

    connection = app.get<Connection>(getConnectionToken());
  });

  beforeEach(async () => {
    // Clear data before every test.
    await Promise.all([
      connection.collection('flights').deleteMany({}),
      connection.collection('cabininventories').deleteMany({}),
      connection.collection('airports').deleteMany({}),
      connection.collection('airlines').deleteMany({}),
    ]);

    cairoId = new Types.ObjectId();
    dubaiId = new Types.ObjectId();
    airlineId = new Types.ObjectId();

    // Seed airports.
    await connection.collection('airports').insertMany([
      {
        _id: cairoId,
        code: 'CAI',
        name: 'Cairo International Airport',
        city: 'Cairo',
        country: 'Egypt',
        timeZone: 'Africa/Cairo',
      },
      {
        _id: dubaiId,
        code: 'DXB',
        name: 'Dubai International Airport',
        city: 'Dubai',
        country: 'United Arab Emirates',
        timeZone: 'Asia/Dubai',
      },
    ]);

    // Seed an active airline.
    await connection.collection('airlines').insertOne({
      _id: airlineId,
      name: 'Test Airline',
      code: 'TA',
      isActive: true,
      baggagePolicy: {
        pricePerExtraBag: 3000,
        maxExtraBagsPerPassenger: 2,
      },
      cancellationTiers: [],
    });
  });

  after(async () => {
    await app?.close();
    await replicaSet?.stop();
  });

  // --------------------------------------------------
  // MINIMUM PRICE
  // --------------------------------------------------

  it('filters flights using minimum price', async () => {
    await seedFlight({
      flightNumber: 'TA101',
      departureHour: 6,
      durationHours: 4,
      price: 10000,
    });

    await seedFlight({
      flightNumber: 'TA102',
      departureHour: 8,
      durationHours: 4,
      price: 20000,
    });

    const response = await search({
      minPrice: '15000',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.items.length, 1);
    assert.equal(response.body.items[0].flightNumber, 'TA102');
  });

  // --------------------------------------------------
  // MAXIMUM PRICE
  // --------------------------------------------------

  it('filters flights using maximum price', async () => {
    await seedFlight({
      flightNumber: 'TA201',
      departureHour: 6,
      durationHours: 4,
      price: 10000,
    });

    await seedFlight({
      flightNumber: 'TA202',
      departureHour: 8,
      durationHours: 4,
      price: 20000,
    });

    const response = await search({
      maxPrice: '15000',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.items.length, 1);
    assert.equal(response.body.items[0].flightNumber, 'TA201');
  });

  // --------------------------------------------------
  // INVALID PRICE RANGE
  // --------------------------------------------------

  it('rejects minimum price greater than maximum price', async () => {
    await seedFlight({
      flightNumber: 'TA301',
      departureHour: 6,
      durationHours: 4,
      price: 10000,
    });

    const response = await search({
      minPrice: '20000',
      maxPrice: '10000',
    });

    assert.equal(response.status, 400);
  });

  // --------------------------------------------------
  // PRICE SORTING
  // --------------------------------------------------

  it('sorts flights by price from lowest to highest', async () => {
    await seedFlight({
      flightNumber: 'TA401',
      departureHour: 6,
      durationHours: 4,
      price: 30000,
    });

    await seedFlight({
      flightNumber: 'TA402',
      departureHour: 8,
      durationHours: 4,
      price: 10000,
    });

    await seedFlight({
      flightNumber: 'TA403',
      departureHour: 10,
      durationHours: 4,
      price: 20000,
    });

    const response = await search({
      sortBy: 'price',
    });

    assert.equal(response.status, 200);

    assert.deepEqual(
      response.body.items.map((flight: any) => flight.flightNumber),
      ['TA402', 'TA403', 'TA401'],
    );
  });

  // --------------------------------------------------
  // DURATION SORTING
  // --------------------------------------------------

  it('sorts flights by duration from shortest to longest', async () => {
    await seedFlight({
      flightNumber: 'TA501',
      departureHour: 6,
      durationHours: 6,
      price: 10000,
    });

    await seedFlight({
      flightNumber: 'TA502',
      departureHour: 8,
      durationHours: 2,
      price: 10000,
    });

    await seedFlight({
      flightNumber: 'TA503',
      departureHour: 10,
      durationHours: 4,
      price: 10000,
    });

    const response = await search({
      sortBy: 'duration',
    });

    assert.equal(response.status, 200);

    assert.deepEqual(
      response.body.items.map((flight: any) => flight.flightNumber),
      ['TA502', 'TA503', 'TA501'],
    );
  });

  // --------------------------------------------------
  // DEPARTURE TIME SORTING
  // --------------------------------------------------

  it('sorts flights by earliest departure time', async () => {
    await seedFlight({
      flightNumber: 'TA601',
      departureHour: 10,
      durationHours: 4,
      price: 10000,
    });

    await seedFlight({
      flightNumber: 'TA602',
      departureHour: 6,
      durationHours: 4,
      price: 10000,
    });

    await seedFlight({
      flightNumber: 'TA603',
      departureHour: 8,
      durationHours: 4,
      price: 10000,
    });

    const response = await search({
      sortBy: 'departureTime',
    });

    assert.equal(response.status, 200);

    assert.deepEqual(
      response.body.items.map((flight: any) => flight.flightNumber),
      ['TA602', 'TA603', 'TA601'],
    );
  });

  // --------------------------------------------------
  // SEAT AVAILABILITY
  // --------------------------------------------------

  it('excludes flights without enough available seats', async () => {
    await seedFlight({
      flightNumber: 'TA701',
      departureHour: 6,
      durationHours: 4,
      price: 10000,
      totalSeats: 5,
      bookedSeats: 2,
      heldSeats: 1,
    });

    await seedFlight({
      flightNumber: 'TA702',
      departureHour: 8,
      durationHours: 4,
      price: 10000,
      totalSeats: 5,
      bookedSeats: 3,
      heldSeats: 1,
    });

    const response = await search({
      adults: '1',
      children: '1',
      infants: '1',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.items.length, 1);

    assert.equal(
      response.body.items[0].flightNumber,
      'TA701',
    );

    assert.equal(
      response.body.items[0].cabins[0].seatsRemaining,
      2,
    );
  });

  // --------------------------------------------------
  // PASSENGER VALIDATION
  // --------------------------------------------------

  it('rejects searches with zero adults', async () => {
    const response = await search({
      adults: '0',
      children: '1',
      infants: '0',
    });

    assert.equal(response.status, 400);
  });

  it('rejects searches with more infants than adults', async () => {
    const response = await search({
      adults: '1',
      children: '0',
      infants: '2',
    });

    assert.equal(response.status, 400);
  });

  it('rejects searches with more than 50 passengers', async () => {
    const response = await search({
      adults: '30',
      children: '20',
      infants: '1',
    });

    assert.equal(response.status, 400);
  });
});