import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request, { Response } from 'supertest';

import { AuthSession } from '../src/auth/schemas/auth-session.schema';
import { UserRole } from '../src/common/enums/user-role.enum';
import { configureApplication } from '../src/configure-application';
import { FlightBookingsService } from '../src/flight-bookings/flight-bookings.service';
import { FlightsModule } from '../src/flights/flights.module';
import { User, UserDocument } from '../src/users/schemas/user.schema';

function cookiesFrom(response: Response): string {
  return (response.headers['set-cookie'] as unknown as string[]).map((cookie) => cookie.split(';')[0]).join('; ');
}

describe('Flights polish: search defaults, local times, inactive airline, my flights (e2e)', { concurrency: false }, () => {
  let replicaSet: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let users: Model<UserDocument>;
  let sessions: Model<AuthSession>;
  let moderatorCookie: string;
  let confirmedUserIds: string[];

  const airlineId = new Types.ObjectId();
  const http = () => request(app.getHttpServer());

  before(async () => {
    replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      binary: { downloadDir: resolve(process.cwd(), 'node_modules/.cache/mongodb-binaries') },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, skipProcessEnv: true, load: [() => ({ JWT_SECRET: randomBytes(48).toString('hex') })] }),
        MongooseModule.forRoot(replicaSet.getUri('flights-polish')),
        FlightsModule,
      ],
    })
      .overrideProvider(FlightBookingsService).useValue({
        syncFlightSchedule: async () => undefined,
        findConfirmedUserIdsForFlight: async () => confirmedUserIds,
        cancelBookingsForFlight: async () => undefined,
        listBookingsForFlight: async () => ({ items: [], page: 1, pageSize: 10, total: 0 }),
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    connection = moduleRef.get(getConnectionToken());
    users = moduleRef.get(getModelToken(User.name));
    sessions = moduleRef.get(getModelToken(AuthSession.name));
    await Promise.all([users.init(), sessions.init()]);
  }, { timeout: 30 * 60_000 });

  beforeEach(async () => {
    confirmedUserIds = [new Types.ObjectId().toString()];
    await Promise.all([
      users.deleteMany({}).exec(), sessions.deleteMany({}).exec(),
      ...['flights', 'cabininventories', 'airports', 'airlines', 'moderatorassignments', 'notifications']
        .map((name) => connection.collection(name).deleteMany({})),
    ]);
    await connection.collection('airports').insertMany([
      { code: 'CAI', timeZone: 'Africa/Cairo' },
      { code: 'DXB', timeZone: 'Asia/Dubai' },
      { code: 'LHR', timeZone: 'Europe/London' },
    ]);
    await connection.collection('airlines').insertOne({
      _id: airlineId, name: 'Test Airline', code: 'TA', isActive: true,
      baggagePolicy: { pricePerExtraBag: 3000, maxExtraBagsPerPassenger: 2 }, cancellationTiers: [],
    });
    await http().post('/api/auth/register')
      .send({ name: 'Test Moderator', email: 'mod@example.com', password: 'Travel123', termsAccepted: true }).expect(201);
    await users.updateOne({ email: 'mod@example.com' }, { $set: { role: UserRole.AIRLINE_MODERATOR } }).exec();
    const login = await http().post('/api/auth/login')
      .set('Sec-Fetch-Site', 'same-origin').send({ email: 'mod@example.com', password: 'Travel123' }).expect(200);
    moderatorCookie = cookiesFrom(login);
    const moderator = await users.findOne({ email: 'mod@example.com' }).orFail().exec();
    await connection.collection('moderatorassignments').insertOne({ moderatorId: moderator._id, airlineId });
  });

  after(async () => {
    try { if (app) await app.close(); } finally { if (replicaSet) await replicaSet.stop(); }
  }, { timeout: 30_000 });

  const create = (flightNumber = 'TA100') => http().post('/api/flights').set('Cookie', moderatorCookie).send({
    flightNumber, departureAirportCode: 'CAI', arrivalAirportCode: 'DXB',
    departureLocalDateTime: '2027-12-10T10:00', arrivalLocalDateTime: '2027-12-10T15:00',
  });

  it('accepts a one-way search without roundTrip, children and infants', async () => {
    const base = { departureAirportCode: 'CAI', arrivalAirportCode: 'DXB', departureDate: '2027-12-10', adults: 1 };
    const result = await http().get('/api/flights/search').query(base).expect(200);
    assert.equal(result.body.total, 0);
    assert.equal(result.body.totalPages, 0);
    assert.equal(result.body.pageSize, 10);
    // The passenger rules still apply with the defaults filled in.
    await http().get('/api/flights/search').query({ ...base, infants: 2 }).expect(400);
  });

  it('returns a readable flight when a flight is created, keeping the old fields', async () => {
    const response = await create().expect(201);
    assert.equal(response.body.flightId, response.body._id);
    assert.equal(response.body.departureAirport.code, 'CAI');
    assert.equal(response.body.arrivalAirport.code, 'DXB');
    assert.equal(response.body.departureLocalDateTime.slice(0, 16), '2027-12-10T10:00');
    assert.deepEqual(response.body.cabins, []);
  });

  it('writes the schedule-change notification in local airport times', async () => {
    const id = (await create().expect(201)).body._id as string;
    await http().patch(`/api/flights/${id}`).set('Cookie', moderatorCookie)
      .send({ departureLocalDateTime: '2027-12-11T09:30', arrivalLocalDateTime: '2027-12-11T14:00' }).expect(200);
    const [row] = await connection.collection('notifications').find({}).toArray();
    assert.ok(row);
    const text = JSON.stringify(row);
    assert.match(text, /CAI at 2027-12-11 09:30/);
    assert.match(text, /DXB at 2027-12-11 14:00/);
    assert.doesNotMatch(text, /\(UTC\)/);
  });

  it('keeps the local clock time when only the arrival airport changes', async () => {
    const id = (await create().expect(201)).body._id as string;
    await http().patch(`/api/flights/${id}`).set('Cookie', moderatorCookie).send({ arrivalAirportCode: 'LHR' }).expect(200);
    const stored = await connection.collection('flights').findOne({ _id: new Types.ObjectId(id) });
    assert.ok(stored);
    // Departure is untouched: 10:00 in Cairo (UTC+2 in December) is 08:00 UTC.
    assert.equal(new Date(stored.departureAt).toISOString(), '2027-12-10T08:00:00.000Z');
    // Arrival stays 15:00 on the clock, now in London (UTC+0 in December) = 15:00 UTC, not the old 11:00 UTC.
    assert.equal(new Date(stored.arrivalAt).toISOString(), '2027-12-10T15:00:00.000Z');
  });

  it('stops a deactivated airline from editing flights and hides its flight page, but not its own list', async () => {
    const id = (await create().expect(201)).body._id as string;
    await http().get(`/api/flights/${id}`).expect(200);
    await connection.collection('airlines').updateOne({ _id: airlineId }, { $set: { isActive: false } });
    await http().patch(`/api/flights/${id}`).set('Cookie', moderatorCookie).send({ arrivalLocalDateTime: '2027-12-10T16:00' }).expect(403);
    await http().post(`/api/flights/${id}/cabins`).set('Cookie', moderatorCookie)
      .send({ cabins: [{ cabinClass: 'ECONOMY', totalSeats: 5, price: 10000, baggageAllowanceCount: 1, baggageMaxWeightKg: 23 }] }).expect(403);
    await http().get(`/api/flights/${id}`).expect(404);
    const mine = await http().get('/api/flights/mine').set('Cookie', moderatorCookie).expect(200);
    assert.equal(mine.body.total, 1);
  });

  it('lists only the moderator\'s own flights, newest departure first, with an optional status filter', async () => {
    await http().get('/api/flights/mine').expect(401);
    await create('TA100').expect(201);
    await create('TA200').expect(201);
    await connection.collection('flights').insertOne({
      airlineId: new Types.ObjectId(), flightNumber: 'ZZ900', status: 'SCHEDULED',
      departureAt: new Date('2027-12-12T08:00:00Z'), arrivalAt: new Date('2027-12-12T12:00:00Z'),
      departureAirportId: new Types.ObjectId(), arrivalAirportId: new Types.ObjectId(), departureLocalDate: '2027-12-12',
    });
    const all = await http().get('/api/flights/mine').set('Cookie', moderatorCookie).expect(200);
    assert.equal(all.body.total, 2);
    assert.equal(all.body.pageSize, 10);
    assert.equal(all.body.totalPages, 1);
    assert.deepEqual(all.body.items.map((item: { flightNumber: string }) => item.flightNumber).sort(), ['TA100', 'TA200']);
    const cancelled = await http().get('/api/flights/mine').query({ status: 'CANCELLED' }).set('Cookie', moderatorCookie).expect(200);
    assert.equal(cancelled.body.total, 0);
    await http().get('/api/flights/mine').query({ status: 'NOPE' }).set('Cookie', moderatorCookie).expect(400);
  });
});
