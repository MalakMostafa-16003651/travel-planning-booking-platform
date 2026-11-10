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
import { FlightsModule } from '../src/flights/flights.module';
import { User, UserDocument } from '../src/users/schemas/user.schema';

function cookiesFrom(response: Response): string {
  return (response.headers['set-cookie'] as unknown as string[]).map((cookie) => cookie.split(';')[0]).join('; ');
}

describe('Passenger list CSV export (FLT-29, e2e)', { concurrency: false }, () => {
  let replicaSet: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let users: Model<UserDocument>;
  let sessions: Model<AuthSession>;

  const airlineId = new Types.ObjectId();
  const otherAirlineId = new Types.ObjectId();
  const cairo = new Types.ObjectId();
  const dubai = new Types.ObjectId();
  let moderatorCookie: string;
  let userCookie: string;
  let ownFlightId: string;
  let foreignFlightId: string;

  async function login(email: string, role: UserRole): Promise<string> {
    await request(app.getHttpServer()).post('/api/auth/register')
      .send({ name: 'Test Person', email, password: 'Travel123', termsAccepted: true }).expect(201);
    await users.updateOne({ email }, { $set: { role } }).exec();
    const response = await request(app.getHttpServer()).post('/api/auth/login')
      .set('Sec-Fetch-Site', 'same-origin').send({ email, password: 'Travel123' }).expect(200);
    return cookiesFrom(response);
  }

  async function seedFlight(owner: Types.ObjectId): Promise<string> {
    const flightId = new Types.ObjectId();
    const departureAt = new Date(Date.now() + 30 * 24 * 3600_000);
    await connection.collection('flights').insertOne({
      _id: flightId, airlineId: owner, flightNumber: 'TA100', status: 'SCHEDULED', departureAt,
      arrivalAt: new Date(departureAt.getTime() + 4 * 3600_000), departureAirportId: cairo, arrivalAirportId: dubai,
      departureLocalDate: departureAt.toISOString().slice(0, 10),
    });
    await connection.collection('cabininventories').insertOne({
      _id: new Types.ObjectId(), flightId, cabinClass: 'ECONOMY', totalSeats: 10, bookedSeats: 3, heldSeats: 1,
      price: 15000, baggageAllowanceCount: 1, baggageMaxWeightKg: 23,
    });
    return flightId.toString();
  }

  before(async () => {
    replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      binary: { downloadDir: resolve(process.cwd(), 'node_modules/.cache/mongodb-binaries') },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, skipProcessEnv: true, load: [() => ({ JWT_SECRET: randomBytes(48).toString('hex') })] }),
        MongooseModule.forRoot(replicaSet.getUri('flight-passenger-csv')),
        FlightsModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    connection = moduleRef.get(getConnectionToken());
    users = moduleRef.get(getModelToken(User.name));
    sessions = moduleRef.get(getModelToken(AuthSession.name));
    await Promise.all([users.init(), sessions.init()]);
  }, { timeout: 30 * 60_000 });

  beforeEach(async () => {
    await Promise.all([
      users.deleteMany({}).exec(), sessions.deleteMany({}).exec(),
      ...['flights', 'cabininventories', 'airports', 'airlines', 'moderatorassignments', 'flightbookings']
        .map((name) => connection.collection(name).deleteMany({})),
    ]);
    await connection.collection('airlines').insertMany([airlineId, otherAirlineId].map((_id) => ({
      _id, name: 'Test Airline', code: String(_id).slice(-4).toUpperCase(), isActive: true,
      baggagePolicy: { pricePerExtraBag: 3000, maxExtraBagsPerPassenger: 2 }, cancellationTiers: [],
    })));
    moderatorCookie = await login('mod@example.com', UserRole.AIRLINE_MODERATOR);
    userCookie = await login('user@example.com', UserRole.USER);
    const moderator = await users.findOne({ email: 'mod@example.com' }).orFail().exec();
    await connection.collection('moderatorassignments').insertOne({ moderatorId: moderator._id, airlineId });
    ownFlightId = await seedFlight(airlineId);
    foreignFlightId = await seedFlight(otherAirlineId);
  });

  after(async () => {
    try { if (app) await app.close(); } finally { if (replicaSet) await replicaSet.stop(); }
  }, { timeout: 30_000 });

  it('rejects requests without a session (401) and normal users (403)', async () => {
    await request(app.getHttpServer()).get(`/api/flights/${ownFlightId}/bookings/export.csv`).expect(401);
    await request(app.getHttpServer()).get(`/api/flights/${ownFlightId}/bookings/export.csv`).set('Cookie', userCookie).expect(403);
  });

  it('hides flights of another airline and unknown or malformed ids (404)', async () => {
    await request(app.getHttpServer()).get(`/api/flights/${foreignFlightId}/bookings/export.csv`).set('Cookie', moderatorCookie).expect(404);
    await request(app.getHttpServer()).get(`/api/flights/${new Types.ObjectId()}/bookings/export.csv`).set('Cookie', moderatorCookie).expect(404);
    await request(app.getHttpServer()).get('/api/flights/not-an-id/bookings/export.csv').set('Cookie', moderatorCookie).expect(404);
  });

  it('exports only the header row when the flight has no bookings', async () => {
    const response = await request(app.getHttpServer()).get(`/api/flights/${ownFlightId}/bookings/export.csv`).set('Cookie', moderatorCookie).expect(200);
    assert.match(response.headers['content-type'], /text\/csv/);
    assert.match(response.headers['content-disposition'], /attachment; filename="flight-/);
    assert.equal(response.text, '"Booking Reference","Passenger Names","Cabin","Seats","Status"');
  });

  it('exports one row per booking, never passport numbers, and neutralises formulas', async () => {
    await connection.collection('flightbookings').insertOne({
      _id: new Types.ObjectId(), userId: new Types.ObjectId(), status: 'CONFIRMED', bookingReference: 'FB-TEST1', seatCount: 2,
      passengers: [{ fullName: '=1+1', passportNumber: 'SECRET123' }, { fullName: 'Ann Lee', passportNumber: 'SECRET456' }],
      segments: [{ flightId: new Types.ObjectId(ownFlightId), cabinClass: 'ECONOMY' }],
    });
    const response = await request(app.getHttpServer()).get(`/api/flights/${ownFlightId}/bookings/export.csv`).set('Cookie', moderatorCookie).expect(200);
    const lines = response.text.split('\r\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[1], `"FB-TEST1","'=1+1; Ann Lee","ECONOMY","2","CONFIRMED"`);
    assert.ok(!response.text.includes('SECRET'));
  });
});
