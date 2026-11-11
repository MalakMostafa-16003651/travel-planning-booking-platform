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
import { NotificationsService } from '../src/notifications/notifications.service';

function cookiesFrom(response: Response): string {
  return (response.headers['set-cookie'] as unknown as string[]).map((cookie) => cookie.split(';')[0]).join('; ');
}

describe('Flight schedule-change notifications (FLT-05 / GEN-01, e2e)', { concurrency: false }, () => {
  let replicaSet: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let users: Model<UserDocument>;
  let sessions: Model<AuthSession>;
  let moderatorCookie: string;
  let confirmedUserIds: string[];

  const airlineId = new Types.ObjectId();
  const cairo = new Types.ObjectId();
  const dubai = new Types.ObjectId();
  let flightId: string;

  before(async () => {
    replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      binary: { downloadDir: resolve(process.cwd(), 'node_modules/.cache/mongodb-binaries') },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, skipProcessEnv: true, load: [() => ({ JWT_SECRET: randomBytes(48).toString('hex') })] }),
        MongooseModule.forRoot(replicaSet.getUri('flight-notifications')),
        FlightsModule,
      ],
    })
      // Person 4's booking service is replaced so this test only checks Person 3's behaviour.
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
    confirmedUserIds = [new Types.ObjectId().toString(), new Types.ObjectId().toString()];
    await Promise.all([
      users.deleteMany({}).exec(), sessions.deleteMany({}).exec(),
      ...['flights', 'cabininventories', 'airports', 'airlines', 'moderatorassignments', 'notifications', 'notificationevents']
        .map((name) => connection.collection(name).deleteMany({})),
    ]);
    await connection.collection('airports').insertMany([
      { _id: cairo, code: 'CAI', timeZone: 'Africa/Cairo' },
      { _id: dubai, code: 'DXB', timeZone: 'Asia/Dubai' },
    ]);
    await connection.collection('airlines').insertOne({
      _id: airlineId, name: 'Test Airline', code: 'TA', isActive: true,
      baggagePolicy: { pricePerExtraBag: 3000, maxExtraBagsPerPassenger: 2 }, cancellationTiers: [],
    });
    await request(app.getHttpServer()).post('/api/auth/register')
      .send({ name: 'Test Moderator', email: 'mod@example.com', password: 'Travel123', termsAccepted: true }).expect(201);
    await users.updateOne({ email: 'mod@example.com' }, { $set: { role: UserRole.AIRLINE_MODERATOR } }).exec();
    const login = await request(app.getHttpServer()).post('/api/auth/login')
      .set('Sec-Fetch-Site', 'same-origin').send({ email: 'mod@example.com', password: 'Travel123' }).expect(200);
    moderatorCookie = cookiesFrom(login);
    const moderator = await users.findOne({ email: 'mod@example.com' }).orFail().exec();
    await connection.collection('moderatorassignments').insertOne({ moderatorId: moderator._id, airlineId });

    const id = new Types.ObjectId();
    const departureAt = new Date(Date.now() + 30 * 24 * 3600_000);
    await connection.collection('flights').insertOne({
      _id: id, airlineId, flightNumber: 'TA100', status: 'SCHEDULED', departureAt,
      arrivalAt: new Date(departureAt.getTime() + 4 * 3600_000), departureAirportId: cairo, arrivalAirportId: dubai,
      departureLocalDate: departureAt.toISOString().slice(0, 10),
    });
    flightId = id.toString();
  });

  after(async () => {
    try { if (app) await app.close(); } finally { if (replicaSet) await replicaSet.stop(); }
  }, { timeout: 30_000 });

  const edit = () => request(app.getHttpServer()).patch(`/api/flights/${flightId}`).set('Cookie', moderatorCookie)
    .send({ departureLocalDateTime: '2027-12-10T15:00', arrivalLocalDateTime: '2027-12-10T19:00' });

  it('creates a FLIGHT_SCHEDULE_CHANGED notification for every passenger with a Confirmed booking', async () => {
    await edit().expect(200);
    const rows = await connection.collection('notifications').find({}).toArray();
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.type === 'FLIGHT_SCHEDULE_CHANGED' && row.isRead === false));
    assert.deepEqual(rows.map((row) => String(row.userId)).sort(), [...confirmedUserIds].sort());
  });

  it('does not notify anyone when the schedule did not change', async () => {
    await connection.collection('notifications').deleteMany({});
    // An empty edit is a validation error (GEN-02), and nothing changes or is sent.
    await request(app.getHttpServer()).patch(`/api/flights/${flightId}`).set('Cookie', moderatorCookie).send({}).expect(400);
    assert.equal(await connection.collection('notifications').countDocuments({}), 0);
  });

  it('still saves the new schedule when a notification cannot be created', async () => {
    const service = app.get(NotificationsService);
    const original = service.notify;
    service.notify = async () => { throw new Error('Inbox temporarily unavailable'); };
    try { await edit().expect(200); } finally { service.notify = original; }
    const saved = await connection.collection('flights').findOne({ _id: new Types.ObjectId(flightId) });
    assert.equal(saved?.departureLocalDate, '2027-12-10');
    assert.equal(await connection.collection('notifications').countDocuments({}), 0);
    assert.equal(await connection.collection('notificationevents').countDocuments({}), 2);
    await service.processEvents();
    await service.processEvents();
    assert.equal(await connection.collection('notificationevents').countDocuments({}), 0);
    assert.equal(await connection.collection('notifications').countDocuments({}), 2);
  });

  it('rolls back the flight schedule if booking propagation fails and retries the same edit', async () => {
    const service = app.get(FlightBookingsService);
    const original = service.syncFlightSchedule;
    const before = await connection.collection('flights').findOne({ _id: new Types.ObjectId(flightId) });
    service.syncFlightSchedule = async () => { throw new Error('Booking propagation unavailable'); };
    try { await edit().expect(500); } finally { service.syncFlightSchedule = original; }
    const after = await connection.collection('flights').findOne({ _id: new Types.ObjectId(flightId) });
    assert.deepEqual(after?.departureAt, before?.departureAt);
    assert.equal(await connection.collection('notificationevents').countDocuments(), 0);
    await edit().expect(200);
    assert.equal(await connection.collection('notifications').countDocuments(), 2);
  });
});
