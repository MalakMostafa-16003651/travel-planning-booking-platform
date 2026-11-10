import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';

import { ItineraryFlightSearchAdapter } from '../src/flights/adapters/itinerary-flight-search.adapter';
import { FlightStatus } from '../src/common/enums/flight-status.enum';
import { FlightsModule } from '../src/flights/flights.module';

const DAY = '2027-12-10';
const BACK = '2027-12-17';

describe('Itinerary flight search adapter (e2e)', { concurrency: false }, () => {
  let replicaSet: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let adapter: ItineraryFlightSearchAdapter;

  const ids = { LHR: new Types.ObjectId(), LGW: new Types.ObjectId(), CAI: new Types.ObjectId() };
  const airlineId = new Types.ObjectId();

  async function seedFlight(number: string, from: Types.ObjectId, to: Types.ObjectId, date: string, hour: number) {
    const departureAt = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00.000Z`);
    const flightId = new Types.ObjectId();
    await connection.collection('flights').insertOne({
      _id: flightId, airlineId, flightNumber: number, status: FlightStatus.SCHEDULED,
      departureAt, arrivalAt: new Date(departureAt.getTime() + 4 * 3600_000),
      departureAirportId: from, arrivalAirportId: to, departureLocalDate: date,
    });
    await connection.collection('cabininventories').insertOne({
      _id: new Types.ObjectId(), flightId, cabinClass: 'ECONOMY', totalSeats: 10, bookedSeats: 0, heldSeats: 0,
      price: 10000, baggageAllowanceCount: 1, baggageMaxWeightKg: 23,
    });
  }

  before(async () => {
    replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      binary: { downloadDir: resolve(process.cwd(), 'node_modules/.cache/mongodb-binaries') },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, skipProcessEnv: true, load: [() => ({ JWT_SECRET: randomBytes(48).toString('hex') })] }),
        MongooseModule.forRoot(replicaSet.getUri('flights-itinerary-test')),
        FlightsModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    connection = app.get<Connection>(getConnectionToken());
    adapter = app.get(ItineraryFlightSearchAdapter);
  });

  beforeEach(async () => {
    await Promise.all(['flights', 'cabininventories', 'airports', 'airlines'].map((name) => connection.collection(name).deleteMany({})));
    await connection.collection('airports').insertMany([
      { _id: ids.LHR, code: 'LHR', name: 'Heathrow', city: 'London', country: 'United Kingdom', timeZone: 'Europe/London' },
      { _id: ids.LGW, code: 'LGW', name: 'Gatwick', city: 'London', country: 'United Kingdom', timeZone: 'Europe/London' },
      { _id: ids.CAI, code: 'CAI', name: 'Cairo International', city: 'Cairo', country: 'Egypt', timeZone: 'Africa/Cairo' },
    ]);
    await connection.collection('airlines').insertOne({
      _id: airlineId, name: 'Test Air', code: 'TA', isActive: true,
      baggagePolicy: { pricePerExtraBag: 1000, maxExtraBagsPerPassenger: 1 }, cancellationTiers: [],
    });
  });

  after(async () => {
    await app?.close();
    await replicaSet?.stop();
  });

  const base = { departureAirportCode: 'CAI', departureDate: DAY, adults: 1, children: 0, infants: 0 };

  it('merges flights to every arrival airport of the city, earliest departure first', async () => {
    await seedFlight('TA201', ids.CAI, ids.LGW, DAY, 9);
    await seedFlight('TA202', ids.CAI, ids.LHR, DAY, 7);
    const result = await adapter.search({ ...base, arrivalAirportCodes: ['LHR', 'LGW'], roundTrip: false }) as { items: { flightNumber: string }[]; total: number };
    assert.equal(result.total, 2);
    assert.deepEqual(result.items.map((flight) => flight.flightNumber), ['TA202', 'TA201']);
  });

  it('returns an empty page, not an error, when nothing matches', async () => {
    const result = await adapter.search({ ...base, arrivalAirportCodes: ['LHR'], roundTrip: false }) as { total: number; items: unknown[] };
    assert.equal(result.total, 0);
    assert.deepEqual(result.items, []);
  });

  it('round trip returns outbound and return lists; return flights must leave after an outbound arrives', async () => {
    await seedFlight('TA301', ids.CAI, ids.LHR, DAY, 7);
    await seedFlight('TA302', ids.LHR, ids.CAI, BACK, 9);
    const result = await adapter.search({ ...base, arrivalAirportCodes: ['LHR'], roundTrip: true, returnDate: BACK }) as {
      outbound: { total: number }; return: { items: { flightNumber: string }[] };
    };
    assert.equal(result.outbound.total, 1);
    assert.deepEqual(result.return.items.map((flight) => flight.flightNumber), ['TA302']);
  });

  it('rejects a round trip without a return date', async () => {
    await assert.rejects(() => adapter.search({ ...base, arrivalAirportCodes: ['LHR'], roundTrip: true }));
  });
});
