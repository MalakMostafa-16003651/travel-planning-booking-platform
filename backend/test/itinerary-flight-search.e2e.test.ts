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
import request, { Response } from 'supertest';
import { AirportsService } from '../src/airports/airports.service';
import { AuthModule } from '../src/auth/auth.module';
import { FlightStatus } from '../src/common/enums/flight-status.enum';
import { configureApplication } from '../src/configure-application';
import { CurrenciesService } from '../src/currencies/currencies.service';
import { ItinerariesModule } from '../src/itineraries/itineraries.module';
import { ReferenceDataService } from '../src/reference-data/reference-data.service';

/**
 * ITN-26 against the REAL Flights search (FlightsService.searchForItinerary, Person 3), through
 * GET /api/itineraries/:id/flights. No test double for the flight port: this checks the binding,
 * multiple destination airports, matching return legs, local same-day timing and pagination.
 *
 * Trip: London (GB), days 2027-12-20 to 2027-12-24. Origin: Cairo (CAI, Africa/Cairo, UTC+2).
 * London has two airports here: LHR (seeded) and LGW (added by this test).
 */
const utc = (iso: string) => new Date(iso);
const HOUR = 60 * 60 * 1000;

describe('ITN-26 itinerary flight search with the real Flights module', { concurrency: false }, () => {
  let replicaSet: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let cookie: string;
  let itineraryId: string;
  let airlineId: Types.ObjectId;
  const airportIds = new Map<string, Types.ObjectId>();

  const http = () => request(app.getHttpServer());

  /** One scheduled flight with an ECONOMY cabin, departing at `departureAt` (UTC). */
  async function seedFlight(flightNumber: string, from: string, to: string, departureAt: Date, durationHours = 5) {
    const flightId = new Types.ObjectId();
    await connection.collection('flights').insertOne({
      _id: flightId,
      airlineId,
      flightNumber,
      status: FlightStatus.SCHEDULED,
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + durationHours * HOUR),
      departureAirportId: airportIds.get(from),
      arrivalAirportId: airportIds.get(to),
    });
    await connection.collection('cabininventories').insertOne({
      _id: new Types.ObjectId(),
      flightId,
      cabinClass: 'ECONOMY',
      totalSeats: 10,
      bookedSeats: 0,
      heldSeats: 0,
      price: 30000,
      baggageAllowanceCount: 1,
      baggageMaxWeightKg: 23,
    });
  }

  const search = (query: Record<string, string>) =>
    http().get(`/api/itineraries/${itineraryId}/flights`).set('Cookie', cookie).query({ departureAirportCode: 'CAI', ...query });

  const numbers = (page: { items: { flightNumber: string }[] }) => page.items.map((flight) => flight.flightNumber);

  function cookiesFrom(response: Response): string {
    return (response.headers['set-cookie'] as unknown as string[]).map((value) => value.split(';')[0]).join('; ');
  }

  before(async () => {
    replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { downloadDir: resolve(process.cwd(), 'node_modules/.cache/mongodb-binaries') },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true, ignoreEnvFile: true, skipProcessEnv: true,
          load: [() => ({ JWT_SECRET: randomBytes(48).toString('hex') })],
        }),
        MongooseModule.forRoot(replicaSet.getUri('itinerary-flight-search')),
        AuthModule,
        ItinerariesModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    connection = moduleRef.get(getConnectionToken());
    await moduleRef.get(CurrenciesService).seedSupported();
    await moduleRef.get(ReferenceDataService).seedSupported();
    await moduleRef.get(AirportsService).seedPredefined();
    await connection.collection('airports').insertOne({
      code: 'LGW', name: 'Gatwick Airport', city: 'London', country: 'United Kingdom', timeZone: 'Europe/London',
    });
    for (const airport of await connection.collection('airports').find().toArray()) {
      airportIds.set(airport.code as string, airport._id as Types.ObjectId);
    }

    const email = 'traveller@example.com';
    await http().post('/api/auth/register').send({ name: 'traveller', email, password: 'Travel123', termsAccepted: true }).expect(201);
    cookie = cookiesFrom(await http().post('/api/auth/login').set('Sec-Fetch-Site', 'same-origin')
      .send({ email, password: 'Travel123' }).expect(200));
    itineraryId = (await http().post('/api/itineraries').set('Cookie', cookie)
      .send({ title: 'London week', countries: ['GB'], startDate: '2027-12-20' }).expect(201)).body.itineraryId;
    for (let day = 0; day < 5; day += 1) {
      await http().post(`/api/itineraries/${itineraryId}/days`).set('Cookie', cookie).send({ city: 'London' }).expect(201);
    }
  }, { timeout: 30 * 60_000 });

  beforeEach(async () => {
    await connection.collection('flights').deleteMany({});
    await connection.collection('cabininventories').deleteMany({});
    await connection.collection('airlines').deleteMany({});
    airlineId = new Types.ObjectId();
    await connection.collection('airlines').insertOne({
      _id: airlineId, name: 'Test Airline', code: 'TA', isActive: true,
      baggagePolicy: { pricePerExtraBag: 3000, maxExtraBagsPerPassenger: 2 }, cancellationTiers: [],
    });
  });

  after(async () => {
    await app?.close();
    await replicaSet?.stop();
  });

  it('searches every airport of the destination city and merges them by departure time', async () => {
    await seedFlight('TA100', 'CAI', 'LHR', utc('2027-12-20T08:00:00Z'));
    await seedFlight('TA200', 'CAI', 'LGW', utc('2027-12-20T06:00:00Z'));
    await seedFlight('TA300', 'CAI', 'LHR', utc('2027-12-20T12:00:00Z'));
    await seedFlight('TA900', 'CAI', 'CDG', utc('2027-12-20T07:00:00Z')); // Paris: not the itinerary city

    const response = (await search({}).expect(200)).body;
    assert.deepEqual([...response.criteria.arrivalAirportCodes].sort(), ['LGW', 'LHR']);
    assert.equal(response.criteria.departureDate, '2027-12-20', 'defaults to the itinerary start');
    assert.deepEqual(numbers(response.results), ['TA200', 'TA100', 'TA300']);
    assert.equal(response.results.total, 3);
    assert.deepEqual(response.results.items.map((flight: { arrivalAirport: { code: string } }) => flight.arrivalAirport.code), ['LGW', 'LHR', 'LHR']);
  });

  it('uses the local calendar day at the departure airport', async () => {
    // Cairo is UTC+2: 2027-12-19T22:30Z is 00:30 on 20 Dec there; 2027-12-20T22:30Z is 00:30 on 21 Dec.
    await seedFlight('TA401', 'CAI', 'LHR', utc('2027-12-19T22:30:00Z'));
    await seedFlight('TA402', 'CAI', 'LGW', utc('2027-12-20T21:30:00Z')); // 23:30 local, still 20 Dec
    await seedFlight('TA403', 'CAI', 'LHR', utc('2027-12-20T22:30:00Z'));

    assert.deepEqual(numbers((await search({}).expect(200)).body.results), ['TA401', 'TA402']);
    assert.deepEqual(numbers((await search({ departureDate: '2027-12-21' }).expect(200)).body.results), ['TA403']);
  });

  it('matches return legs from any city airport, on the return date and after an outbound arrival', async () => {
    await seedFlight('TA501', 'CAI', 'LHR', utc('2027-12-20T06:00:00Z'), 5); // arrives 11:00Z
    // Default return date is the last itinerary day, 2027-12-24.
    await seedFlight('TA601', 'LHR', 'CAI', utc('2027-12-24T09:00:00Z'));
    await seedFlight('TA602', 'LGW', 'CAI', utc('2027-12-24T15:00:00Z'));
    await seedFlight('TA603', 'LHR', 'CAI', utc('2027-12-23T09:00:00Z')); // wrong day
    await seedFlight('TA604', 'CDG', 'CAI', utc('2027-12-24T10:00:00Z')); // not a London airport

    const response = (await search({ roundTrip: 'true' }).expect(200)).body;
    assert.equal(response.criteria.returnDate, '2027-12-24');
    assert.deepEqual(numbers(response.results.outbound), ['TA501']);
    assert.deepEqual(numbers(response.results.return), ['TA601', 'TA602']);
    assert.deepEqual(numbers((await search({ roundTrip: 'true', returnDate: '2027-12-23' }).expect(200)).body.results.return), ['TA603']);
  });

  it('keeps only same-day return legs that leave after an outbound flight lands', async () => {
    await seedFlight('TA701', 'CAI', 'LHR', utc('2027-12-20T06:00:00Z'), 5); // lands 11:00Z
    await seedFlight('TA702', 'LHR', 'CAI', utc('2027-12-20T10:00:00Z')); // before landing
    await seedFlight('TA703', 'LGW', 'CAI', utc('2027-12-20T15:00:00Z')); // after landing

    const response = (await search({ roundTrip: 'true', returnDate: '2027-12-20' }).expect(200)).body;
    assert.deepEqual(numbers(response.results.outbound), ['TA701']);
    assert.deepEqual(numbers(response.results.return), ['TA703']);
  });

  it('paginates the merged list once, 10 per page, across both airports', async () => {
    for (let i = 0; i < 12; i += 1) {
      const to = i % 2 === 0 ? 'LHR' : 'LGW';
      await seedFlight(`TA8${String(i).padStart(2, '0')}`, 'CAI', to, new Date(utc('2027-12-20T06:00:00Z').getTime() + i * HOUR / 2));
    }
    const first = (await search({}).expect(200)).body.results;
    assert.equal(first.total, 12);
    assert.equal(first.pageSize, 10);
    assert.deepEqual(numbers(first), ['TA800', 'TA801', 'TA802', 'TA803', 'TA804', 'TA805', 'TA806', 'TA807', 'TA808', 'TA809']);
    const second = (await search({ page: '2' }).expect(200)).body.results;
    assert.equal(second.page, 2);
    assert.deepEqual(numbers(second), ['TA810', 'TA811']);
  });

  it('rejects invalid itinerary-derived requests before searching', async () => {
    await search({ departureAirportCode: 'XXX' }).expect(400);
    await search({ departureAirportCode: 'LHR' }).expect(200); // LGW remains a different London airport
    await search({ returnDate: '2027-12-24' }).expect(400); // return date without a round trip
    await search({ roundTrip: 'true', departureDate: '2027-12-22', returnDate: '2027-12-21' }).expect(400);
    await search({ adults: '1', infants: '2' }).expect(400);
  });
});
