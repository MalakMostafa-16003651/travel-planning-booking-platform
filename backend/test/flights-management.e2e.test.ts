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
import { FlightsService } from '../src/flights/flights.service';
import { User, UserDocument } from '../src/users/schemas/user.schema';

const DAY_MS = 24 * 60 * 60 * 1000;

function cookiesFrom(response: Response): string {
  const header = response.headers['set-cookie'] as unknown as string[];
  return header.map((cookie) => cookie.split(';')[0]).join('; ');
}

describe('Flight management E2E', { concurrency: false }, () => {
  let replicaSet: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;

  let users: Model<UserDocument>;
  let sessions: Model<AuthSession>;
  let flightsService: FlightsService;

  const cairo = new Types.ObjectId();
  const dubai = new Types.ObjectId();
  const airlineId = new Types.ObjectId();

  let moderatorCookie: string;
  let moderatorId: Types.ObjectId;

  async function login(
    email: string,
    role = UserRole.USER,
  ): Promise<string> {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Test Moderator',
        email,
        password: 'Travel123',
        termsAccepted: true,
      })
      .expect(201);

    await users.updateOne({ email }, { $set: { role } }).exec();

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Sec-Fetch-Site', 'same-origin')
      .send({ email, password: 'Travel123' })
      .expect(200);

    return cookiesFrom(response);
  }

  async function seedFlight(options: {
    departsInDays?: number;
    seats?: number;
    bookedSeats?: number;
    heldSeats?: number;
    status?: string;
  } = {}) {
    const flightId = new Types.ObjectId();
    const cabinId = new Types.ObjectId();

    const departureAt = new Date(
      Date.now() + (options.departsInDays ?? 30) * DAY_MS,
    );

    const arrivalAt = new Date(departureAt.getTime() + 4 * 60 * 60 * 1000);

    await connection.collection('flights').insertOne({
      _id: flightId,
      airlineId,
      flightNumber: `MS${Math.floor(Math.random() * 900) + 100}`,
      status: options.status ?? 'SCHEDULED',
      departureAt,
      arrivalAt,
      departureAirportId: cairo,
      arrivalAirportId: dubai,
      departureLocalDate: departureAt.toISOString().slice(0, 10),
    });

    await connection.collection('cabininventories').insertOne({
      _id: cabinId,
      flightId,
      cabinClass: 'ECONOMY',
      totalSeats: options.seats ?? 10,
      bookedSeats: options.bookedSeats ?? 0,
      heldSeats: options.heldSeats ?? 0,
      price: 15000,
      baggageAllowanceCount: 1,
      baggageMaxWeightKg: 23,
    });

    return {
      flightId: flightId.toString(),
      cabinId: cabinId.toString(),
      departureAt,
      arrivalAt,
    };
  }

  before(async () => {
    replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      binary: {
        downloadDir: resolve(
          process.cwd(),
          'node_modules/.cache/mongodb-binaries',
        ),
      },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          skipProcessEnv: true,
          load: [() => ({ JWT_SECRET: randomBytes(48).toString('hex') })],
        }),
        MongooseModule.forRoot(replicaSet.getUri('flight-management')),
        FlightsModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();

    connection = moduleRef.get(getConnectionToken());

    users = moduleRef.get(getModelToken(User.name));
    sessions = moduleRef.get(getModelToken(AuthSession.name));

    flightsService = moduleRef.get(FlightsService, { strict: false });

    await Promise.all([users.init(), sessions.init()]);
  }, { timeout: 30 * 60_000 });

  beforeEach(async () => {
    await Promise.all([
      users.deleteMany({}).exec(),
      sessions.deleteMany({}).exec(),

      ...[
        'flights',
        'cabininventories',
        'airports',
        'airlines',
        'moderatorassignments',
        'flightbookings',
      ].map((name) => connection.collection(name).deleteMany({})),
    ]);

    await connection.collection('airports').insertMany([
      { _id: cairo, code: 'CAI', timeZone: 'Africa/Cairo' },
      { _id: dubai, code: 'DXB', timeZone: 'Asia/Dubai' },
    ]);

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

    moderatorCookie = await login(
      'moderator@example.com',
      UserRole.AIRLINE_MODERATOR,
    );

    const moderator = await users.findOne({
      email: 'moderator@example.com',
    }).orFail().exec();

    moderatorId = moderator._id as Types.ObjectId;

    await connection.collection('moderatorassignments').insertOne({
      moderatorId,
      airlineId,
    });
  });

  after(async () => {
    try {
      if (app) await app.close();
    } finally {
      if (replicaSet) await replicaSet.stop();
    }
  }, { timeout: 30_000 });

  describe('Flight editing - FLT-05', () => {
    it('updates a scheduled flight departure and arrival time', async () => {
      const flight = await seedFlight();

      await request(app.getHttpServer())
        .patch(`/api/flights/${flight.flightId}`)
        .set('Cookie', moderatorCookie)
        .send({
          departureLocalDateTime: '2027-12-10T15:00',
          arrivalLocalDateTime: '2027-12-10T19:00',
        })
        .expect(200);

      const updated = await connection.collection('flights').findOne({
        _id: new Types.ObjectId(flight.flightId),
      });

      assert.ok(updated);
      assert.equal(updated.departureLocalDate, '2027-12-10');
      assert.notEqual(
        new Date(updated.departureAt).getTime(),
        flight.departureAt.getTime(),
      );
      assert.ok(
        new Date(updated.arrivalAt).getTime() >
        new Date(updated.departureAt).getTime(),
      );
    });

    it('rejects an arrival time before departure', async () => {
      const flight = await seedFlight();

      await request(app.getHttpServer())
        .patch(`/api/flights/${flight.flightId}`)
        .set('Cookie', moderatorCookie)
        .send({
          departureLocalDateTime: '2027-12-10T19:00',
          arrivalLocalDateTime: '2027-12-10T15:00',
        })
        .expect(400);
    });

    it('rejects a departure time in the past', async () => {
      const flight = await seedFlight();

      await request(app.getHttpServer())
        .patch(`/api/flights/${flight.flightId}`)
        .set('Cookie', moderatorCookie)
        .send({
          departureLocalDateTime: '2020-01-01T10:00',
        })
        .expect(400);
    });
  });

  describe('Cabin editing - FLT-05 / FLT-08', () => {
    it('updates cabin capacity, price and baggage allowance', async () => {
      const flight = await seedFlight();

      await request(app.getHttpServer())
        .patch(
          `/api/flights/${flight.flightId}/cabins/${flight.cabinId}`,
        )
        .set('Cookie', moderatorCookie)
        .send({
          totalSeats: 20,
          price: 20000,
          baggageAllowanceCount: 2,
          baggageMaxWeightKg: 30,
        })
        .expect(200);

      const cabin = await connection.collection('cabininventories').findOne({
        _id: new Types.ObjectId(flight.cabinId),
      });

      assert.ok(cabin);
      assert.equal(cabin.totalSeats, 20);
      assert.equal(cabin.price, 20000);
      assert.equal(cabin.baggageAllowanceCount, 2);
      assert.equal(cabin.baggageMaxWeightKg, 30);
    });

    it('does not reduce capacity below booked and held seats', async () => {
      const flight = await seedFlight({
        seats: 10,
        bookedSeats: 4,
        heldSeats: 3,
      });

      await request(app.getHttpServer())
        .patch(
          `/api/flights/${flight.flightId}/cabins/${flight.cabinId}`,
        )
        .set('Cookie', moderatorCookie)
        .send({ totalSeats: 6 })
        .expect(409);

      const cabin = await connection.collection('cabininventories').findOne({
        _id: new Types.ObjectId(flight.cabinId),
      });

      assert.equal(cabin!.totalSeats, 10);
    });
  });

  describe('Flight cancellation - FLT-06', () => {
    it('cancels a scheduled flight', async () => {
      const flight = await seedFlight();

      await request(app.getHttpServer())
        .post(`/api/flights/${flight.flightId}/cancel`)
        .set('Cookie', moderatorCookie)
        .expect(201);

      const updated = await connection.collection('flights').findOne({
        _id: new Types.ObjectId(flight.flightId),
      });

      assert.equal(updated!.status, 'CANCELLED');
    });

    it('does not allow cancellation after departure', async () => {
      const flight = await seedFlight({
        status: 'DEPARTED',
      });

      await request(app.getHttpServer())
        .post(`/api/flights/${flight.flightId}/cancel`)
        .set('Cookie', moderatorCookie)
        .expect(409);

      const updated = await connection.collection('flights').findOne({
        _id: new Types.ObjectId(flight.flightId),
      });

      assert.equal(updated!.status, 'DEPARTED');
    });

    it('does not cancel bookings if departure wins after the initial flight read', async () => {
      const flight = await seedFlight();
      const model = connection.model('Flight');
      const original = model.findOneAndUpdate.bind(model);
      let raced = false;
      model.findOneAndUpdate = ((...args: Parameters<typeof original>) => {
        const query = original(...args);
        const exec = query.exec.bind(query);
        query.exec = async () => {
          if (!raced) {
            raced = true;
            await connection.collection('flights').updateOne({ _id: new Types.ObjectId(flight.flightId) },
              { $set: { status: 'DEPARTED', departureAt: new Date(Date.now() - 1000) } });
          }
          return exec();
        };
        return query;
      }) as typeof model.findOneAndUpdate;
      try {
        await request(app.getHttpServer()).post(`/api/flights/${flight.flightId}/cancel`)
          .set('Cookie', moderatorCookie).expect(409);
        const stored = await connection.collection('flights').findOne({ _id: new Types.ObjectId(flight.flightId) });
        assert.equal(stored!.status, 'DEPARTED');
        assert.equal(raced, true);
      } finally { model.findOneAndUpdate = original; }
    });
  });

  describe('Automatic flight status - FLT-30', () => {
    it('marks scheduled flights as departed when departure time passes', async () => {
      const flight = await seedFlight({
        departsInDays: -1,
      });

      await flightsService.markDeparted();

      const updated = await connection.collection('flights').findOne({
        _id: new Types.ObjectId(flight.flightId),
      });

      assert.equal(updated!.status, 'DEPARTED');
    });
  });

  describe('Authorization', () => {
    it('requires an authenticated airline moderator', async () => {
      const flight = await seedFlight();

      await request(app.getHttpServer())
        .patch(`/api/flights/${flight.flightId}`)
        .send({
          departureLocalDateTime: '2027-12-10T15:00',
        })
        .expect(401);

      const ordinaryUser = await login('user@example.com');

      await request(app.getHttpServer())
        .patch(`/api/flights/${flight.flightId}`)
        .set('Cookie', ordinaryUser)
        .send({
          departureLocalDateTime: '2027-12-10T15:00',
        })
        .expect(403);
    });
  });
});
