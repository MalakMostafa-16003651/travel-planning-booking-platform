import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { ConflictException, INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request, { Response } from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { AuthSession } from '../src/auth/schemas/auth-session.schema';
import { BookingStatus } from '../src/common/enums/booking-status.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { configureApplication } from '../src/configure-application';
import { FlightBookingsMaintenanceService } from '../src/flight-bookings/flight-bookings-maintenance.service';
import { FlightBookingsModule } from '../src/flight-bookings/flight-bookings.module';
import { FlightBookingsService } from '../src/flight-bookings/flight-bookings.service';
import { BOOKING_NOTIFICATIONS, BookingNotification } from '../src/flight-bookings/ports/booking-notifications.port';
import { BOOKING_PAYMENTS, BookingRefundStatus, RefundRequest } from '../src/flight-bookings/ports/booking-payments.port';
import { FLIGHT_INVENTORY, FlightInventoryPort } from '../src/flight-bookings/ports/flight-inventory.port';
import { FlightBooking } from '../src/flight-bookings/schemas/flight-booking.schema';
import { User, UserDocument } from '../src/users/schemas/user.schema';

const DAY_MS = 24 * 60 * 60 * 1000;
const ECONOMY_FARE = 15000;
const BAG_PRICE = 3000;
const OVERBOOKING_ATTEMPTS = 12;

class FakePayments {
  cancelled: string[] = [];
  refunds: RefundRequest[] = [];
  failNextRefund = false;

  async cancelPendingPayment({ bookingId }: { bookingId: string }) {
    this.cancelled.push(bookingId);
  }

  async createRefund(refund: RefundRequest) {
    if (this.failNextRefund) {
      this.failNextRefund = false;
      throw new Error('Stripe unavailable');
    }
    this.refunds.push(refund);
    const refundId = new Types.ObjectId().toString();
    this.statuses.set(refund.bookingId, { refundId, status: 'PENDING', amount: refund.amount, currency: 'USD' });
    return { refundId };
  }

  statuses = new Map<string, BookingRefundStatus>();

  async getRefundStatus({ bookingId }: { bookingId: string }) {
    return this.statuses.get(bookingId) ?? null;
  }
}

class FakeNotifications {
  sent: BookingNotification[] = [];

  async notify(notification: BookingNotification) {
    this.sent.push(notification);
  }
}

function adult(overrides: Record<string, unknown> = {}) {
  return { fullName: 'Alex Traveler', dateOfBirth: '1995-04-12', documentNumber: 'A12345678', type: 'ADULT', ...overrides };
}

function yearsBefore(date: Date, years: number): string {
  const birth = new Date(date);
  birth.setUTCFullYear(birth.getUTCFullYear() - years);
  return birth.toISOString().slice(0, 10);
}

function cookiesFrom(response: Response): string {
  const header = response.headers['set-cookie'] as unknown as string[];
  return header.map((cookie) => cookie.split(';')[0]).join('; ');
}

describe('Flight booking and inventory holds', { concurrency: false }, () => {
  let replicaSet: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let users: Model<UserDocument>;
  let sessions: Model<AuthSession>;
  let bookings: Model<FlightBooking>;
  let service: FlightBookingsService;
  let maintenance: FlightBookingsMaintenanceService;
  const payments = new FakePayments();
  const notifications = new FakeNotifications();

  const cairo = new Types.ObjectId();
  const dubai = new Types.ObjectId();
  const airlineId = new Types.ObjectId();
  let traveler: string;

  async function login(email: string, role = UserRole.USER): Promise<string> {
    await request(app.getHttpServer()).post('/api/auth/register')
      .send({ name: 'Test User', email, password: 'Travel123', termsAccepted: true }).expect(201);
    await users.updateOne({ email }, { $set: { role } }).exec();
    const response = await request(app.getHttpServer()).post('/api/auth/login')
      .set('Sec-Fetch-Site', 'same-origin').send({ email, password: 'Travel123' }).expect(200);
    return cookiesFrom(response);
  }

  async function seedFlight(options: { from?: Types.ObjectId; to?: Types.ObjectId; departsInDays?: number; seats?: number; status?: string; airline?: Types.ObjectId } = {}) {
    const flightId = new Types.ObjectId();
    const cabinId = new Types.ObjectId();
    const departureAt = new Date(Date.now() + (options.departsInDays ?? 30) * DAY_MS);
    await connection.collection('flights').insertOne({
      _id: flightId,
      airlineId: options.airline ?? airlineId,
      flightNumber: `MS${Math.floor(Math.random() * 900) + 100}`,
      status: options.status ?? 'SCHEDULED',
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + 4 * 60 * 60 * 1000),
      departureAirportId: options.from ?? cairo,
      arrivalAirportId: options.to ?? dubai,
    });
    await connection.collection('cabininventories').insertOne({
      _id: cabinId,
      flightId,
      cabinClass: 'ECONOMY',
      totalSeats: options.seats ?? 10,
      heldSeats: 0,
      bookedSeats: 0,
      price: ECONOMY_FARE,
      baggageMaxWeightKg: 23,
    });
    return { flightId: flightId.toString(), cabinId: cabinId.toString(), departureAt };
  }

  const seats = async (cabinId: string) => {
    const cabin = await connection.collection('cabininventories').findOne({ _id: new Types.ObjectId(cabinId) });
    return { held: cabin!.heldSeats as number, booked: cabin!.bookedSeats as number };
  };

  type Selection = { flightId: string; cabinId: string };
  const selection = (segments: Selection[]) => segments.map(({ flightId, cabinId }) => ({ flightId, cabinId }));

  const hold = (segments: Selection[], passengers: unknown[] = [adult()], cookie = traveler) =>
    request(app.getHttpServer()).post('/api/flight-bookings/hold').set('Cookie', cookie).send({ segments: selection(segments), passengers });

  const summarize = (segments: Selection[], passengers: unknown[] = [adult()], cookie = traveler) =>
    request(app.getHttpServer()).post('/api/flight-bookings').set('Cookie', cookie).send({ segments: selection(segments), passengers });

  async function confirmedBooking(segment: Selection, passengers: unknown[] = [adult()]) {
    const held = await hold([segment], passengers).expect(201);
    await service.confirmPaidBooking(held.body.flightBookingId, new Types.ObjectId().toString());
    return held.body.flightBookingId as string;
  }

  before(async () => {
    replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      binary: { downloadDir: resolve(process.cwd(), 'node_modules/.cache/mongodb-binaries') },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          skipProcessEnv: true,
          load: [() => ({ JWT_SECRET: randomBytes(48).toString('hex') })],
        }),
        MongooseModule.forRoot(replicaSet.getUri('flight-bookings')),
        AuthModule,
        FlightBookingsModule,
      ],
    })
      .overrideProvider(BOOKING_PAYMENTS).useValue(payments)
      .overrideProvider(BOOKING_NOTIFICATIONS).useValue(notifications)
      .compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();

    connection = moduleRef.get(getConnectionToken());
    users = moduleRef.get(getModelToken(User.name));
    sessions = moduleRef.get(getModelToken(AuthSession.name));
    bookings = moduleRef.get(getModelToken(FlightBooking.name));
    service = moduleRef.get(FlightBookingsService, { strict: false });
    maintenance = moduleRef.get(FlightBookingsMaintenanceService, { strict: false });
    await Promise.all([users.init(), sessions.init(), bookings.init()]);
  }, { timeout: 30 * 60_000 });

  beforeEach(async () => {
    await Promise.all([
      users.deleteMany({}).exec(),
      sessions.deleteMany({}).exec(),
      bookings.deleteMany({}).exec(),
      ...['flights', 'cabininventories', 'airports', 'airlines'].map((name) => connection.collection(name).deleteMany({})),
    ]);
    await connection.collection('airports').insertMany([
      { _id: cairo, code: 'CAI', timeZone: 'Africa/Cairo' },
      { _id: dubai, code: 'DXB', timeZone: 'Asia/Dubai' },
    ]);
    await connection.collection('airlines').insertOne({
      _id: airlineId,
      isActive: true,
      baggagePolicy: { pricePerExtraBag: BAG_PRICE, maxExtraBagsPerPassenger: 2 },
      cancellationTiers: [
        { daysBeforeDeparture: 0, refundPercentage: 10 },
        { daysBeforeDeparture: 7, refundPercentage: 50 },
        { daysBeforeDeparture: 14, refundPercentage: 100 },
      ],
    });
    payments.cancelled = [];
    payments.refunds = [];
    payments.failNextRefund = false;
    payments.statuses.clear();
    notifications.sent = [];
    traveler = await login('traveler@example.com');
  });

  after(async () => {
    try {
      if (app) await app.close();
    } finally {
      if (replicaSet) await replicaSet.stop();
    }
  }, { timeout: 30_000 });

  describe('FLT-19/FLT-21 summary and validation', () => {
    it('prices a booking without reserving seats or storing anything', async () => {
      const flight = await seedFlight();
      const response = await summarize([flight], [adult({ extraBags: 2, extraBaggageWeightKg: 40 })]).expect(200);

      assert.equal(response.body.totalAmount, ECONOMY_FARE + 2 * BAG_PRICE);
      assert.equal(response.body.baggageFee, 2 * BAG_PRICE);
      assert.equal(response.body.seatCount, 1);
      assert.deepEqual(await seats(flight.cabinId), { held: 0, booked: 0 });
      assert.equal(await bookings.countDocuments().exec(), 0);
    });

    it('charges children the fare and infants 10% with no seat (FLT-12)', async () => {
      const flight = await seedFlight();
      const passengers = [
        adult(),
        adult({ fullName: 'Child', dateOfBirth: yearsBefore(flight.departureAt, 5), type: 'CHILD' }),
        adult({ fullName: 'Infant', dateOfBirth: yearsBefore(flight.departureAt, 1), type: 'INFANT' }),
      ];
      const response = await hold([flight], passengers).expect(201);

      assert.equal(response.body.totalAmount, 2 * ECONOMY_FARE + ECONOMY_FARE * 0.1);
      assert.equal(response.body.seatCount, 2);
      assert.deepEqual(await seats(flight.cabinId), { held: 2, booked: 0 });
    });

    it('applies the age boundaries on the outbound departure date', async () => {
      const flight = await seedFlight();
      const twelve = adult({ dateOfBirth: yearsBefore(flight.departureAt, 12) });
      await summarize([flight], [twelve]).expect(200);
      await summarize([flight], [adult(), adult({ dateOfBirth: yearsBefore(flight.departureAt, 2), type: 'CHILD' })]).expect(200);
      await summarize([flight], [adult(), adult({ dateOfBirth: yearsBefore(flight.departureAt, 2), type: 'INFANT' })]).expect(400);
    });

    for (const [name, passengers] of Object.entries({
      'no adult': [adult({ dateOfBirth: '2020-01-01', type: 'CHILD' })],
      'more infants than adults': [
        adult(),
        adult({ dateOfBirth: new Date(Date.now() - 200 * DAY_MS).toISOString().slice(0, 10), type: 'INFANT' }),
        adult({ dateOfBirth: new Date(Date.now() - 200 * DAY_MS).toISOString().slice(0, 10), type: 'INFANT' }),
      ],
      'type not matching date of birth': [adult({ dateOfBirth: '2020-01-01' })],
      'too many extra bags': [adult({ extraBags: 3, extraBaggageWeightKg: 30 })],
      'bags over the weight limit': [adult({ extraBags: 1, extraBaggageWeightKg: 24 })],
      'bags without a weight': [adult({ extraBags: 1 })],
      'weight without bags': [adult({ extraBaggageWeightKg: 10 })],
      'malformed date of birth': [adult({ dateOfBirth: 'yesterday' })],
      'malformed document number': [adult({ documentNumber: '$$' })],
      'an unknown property': [adult({ fare: 1 })],
    })) {
      it(`rejects ${name}`, async () => {
        const flight = await seedFlight();
        await hold([flight], passengers).expect(400);
        assert.deepEqual(await seats(flight.cabinId), { held: 0, booked: 0 });
      });
    }

    it('reports unknown flights and a cabin from another flight as 404', async () => {
      const first = await seedFlight();
      const second = await seedFlight();
      await hold([{ flightId: new Types.ObjectId().toString(), cabinId: first.cabinId }]).expect(404);
      await hold([{ flightId: first.flightId, cabinId: second.cabinId }]).expect(404);
    });

    it('refuses cancelled, departed and deactivated-airline flights', async () => {
      await hold([await seedFlight({ status: 'CANCELLED' })]).expect(409);
      await hold([await seedFlight({ departsInDays: -1 })]).expect(409);
      const inactive = new Types.ObjectId();
      await connection.collection('airlines').insertOne({ _id: inactive, isActive: false });
      await hold([await seedFlight({ airline: inactive })]).expect(409);
    });

    it('requires a session and role USER', async () => {
      const flight = await seedFlight();
      const body = { segments: selection([flight]), passengers: [adult()] };
      await request(app.getHttpServer()).post('/api/flight-bookings/hold').send(body).expect(401);
      await request(app.getHttpServer()).get('/api/flight-bookings').expect(401);
      const moderator = await login('moderator@example.com', UserRole.AIRLINE_MODERATOR);
      await hold([flight], [adult()], moderator).expect(403);
      // Shared RolesGuard: only role USER has flight bookings.
      await request(app.getHttpServer()).get('/api/flight-bookings').set('Cookie', moderator).expect(403);
    });
  });

  describe('FLT-22 holds', () => {
    it('creates a Pending booking held for 10 minutes', async () => {
      const flight = await seedFlight();
      const before = Date.now();
      const response = await hold([flight]).expect(201);

      assert.equal(response.body.status, BookingStatus.PENDING);
      assert.equal(response.body.bookingReference, undefined);
      const held = new Date(response.body.holdExpiresAt).getTime() - before;
      assert.ok(held >= 10 * 60_000 && held < 10 * 60_000 + 30_000);
      assert.deepEqual(await seats(flight.cabinId), { held: 1, booked: 0 });
    });

    it('never holds more seats than exist under concurrent requests', async () => {
      const flight = await seedFlight({ seats: 5 });
      const responses = await Promise.all(Array.from({ length: OVERBOOKING_ATTEMPTS }, () => hold([flight], [adult(), adult()])));
      const statuses = responses.map(({ status }) => status);

      assert.equal(statuses.filter((status) => status === 201).length, 2);
      assert.equal(statuses.filter((status) => status === 409).length, OVERBOOKING_ATTEMPTS - 2);
      assert.deepEqual(await seats(flight.cabinId), { held: 4, booked: 0 });
      assert.equal(await bookings.countDocuments().exec(), 2);
    });

    it('books a round trip as one booking across two cabins', async () => {
      const outbound = await seedFlight({ departsInDays: 30 });
      const inbound = await seedFlight({ from: dubai, to: cairo, departsInDays: 37 });
      const response = await hold([outbound, inbound], [adult({ extraBags: 1, extraBaggageWeightKg: 20 })]).expect(201);

      assert.equal(response.body.segments.length, 2);
      assert.equal(response.body.baggageFee, 2 * BAG_PRICE);
      assert.equal(response.body.totalAmount, 2 * ECONOMY_FARE + 2 * BAG_PRICE);
      assert.deepEqual(await seats(outbound.cabinId), { held: 1, booked: 0 });
      assert.deepEqual(await seats(inbound.cabinId), { held: 1, booked: 0 });
    });

    it('holds nothing when the return flight is full', async () => {
      const outbound = await seedFlight({ departsInDays: 30 });
      const inbound = await seedFlight({ from: dubai, to: cairo, departsInDays: 37, seats: 1 });
      await hold([outbound, inbound], [adult(), adult()]).expect(409);

      assert.deepEqual(await seats(outbound.cabinId), { held: 0, booked: 0 });
      assert.equal(await bookings.countDocuments().exec(), 0);
    });

    it('rejects a return flight on the wrong route or before arrival', async () => {
      const outbound = await seedFlight({ departsInDays: 30 });
      await hold([outbound, await seedFlight({ departsInDays: 37 })]).expect(400);
      await hold([outbound, await seedFlight({ from: dubai, to: cairo, departsInDays: 29 })]).expect(400);
    });

    it('expires overdue holds, releases seats and cancels the payment', async () => {
      const flight = await seedFlight();
      const { body } = await hold([flight]).expect(201);
      await bookings.updateOne({ _id: body.flightBookingId }, { $set: { holdExpiresAt: new Date(Date.now() - 1000) } }).exec();

      await maintenance.sweep();

      const booking = await bookings.findById(body.flightBookingId).orFail().exec();
      assert.equal(booking.status, BookingStatus.EXPIRED);
      assert.deepEqual(await seats(flight.cabinId), { held: 0, booked: 0 });
      assert.deepEqual(payments.cancelled, [body.flightBookingId]);
    });

    it('leaves live holds alone and releases expired ones only once', async () => {
      const flight = await seedFlight();
      await hold([flight]).expect(201);
      const { body } = await hold([flight]).expect(201);
      await bookings.updateOne({ _id: body.flightBookingId }, { $set: { holdExpiresAt: new Date(Date.now() - 1000) } }).exec();

      await Promise.all([service.expireOverdueHolds(), service.expireOverdueHolds()]);

      assert.deepEqual(await seats(flight.cabinId), { held: 1, booked: 0 });
      assert.equal(await bookings.countDocuments({ status: BookingStatus.PENDING }).exec(), 1);
    });
  });

  describe('FLT-23 confirmation and e-ticket', () => {
    it('confirms, converts seats, sets a reference and notifies the user', async () => {
      const flight = await seedFlight();
      const { body } = await hold([flight]).expect(201);
      const paymentId = new Types.ObjectId().toString();

      await service.confirmPaidBooking(body.flightBookingId, paymentId);

      const booking = await bookings.findById(body.flightBookingId).orFail().exec();
      assert.equal(booking.status, BookingStatus.CONFIRMED);
      assert.match(booking.bookingReference!, /^[A-Z2-9]{8}$/);
      assert.equal(booking.paymentId?.toString(), paymentId);
      assert.equal(booking.holdExpiresAt, undefined);
      assert.deepEqual(await seats(flight.cabinId), { held: 0, booked: 1 });
      assert.equal(notifications.sent.length, 1);
      assert.equal(notifications.sent[0].type, 'BOOKING_CONFIRMED');
    });

    it('treats repeated and concurrent webhooks as one confirmation', async () => {
      const flight = await seedFlight();
      const { body } = await hold([flight]).expect(201);
      const paymentId = new Types.ObjectId().toString();

      await Promise.all([
        service.confirmPaidBooking(body.flightBookingId, paymentId),
        service.confirmPaidBooking(body.flightBookingId, paymentId),
      ]);
      await service.confirmPaidBooking(body.flightBookingId, paymentId);

      assert.deepEqual(await seats(flight.cabinId), { held: 0, booked: 1 });
      assert.equal(notifications.sent.length, 1);
    });

    it('refuses payment once the hold has ended, even before the sweep runs', async () => {
      const flight = await seedFlight();
      const { body } = await hold([flight]).expect(201);
      await bookings.updateOne({ _id: body.flightBookingId }, { $set: { holdExpiresAt: new Date(Date.now() - 1000) } }).exec();

      await assert.rejects(service.confirmPaidBooking(body.flightBookingId, new Types.ObjectId().toString()), ConflictException);
      await assert.rejects(service.getPayableBooking(body.flightBookingId, body.userId), ConflictException);
      assert.deepEqual(await seats(flight.cabinId), { held: 1, booked: 0 });
    });

    it('rejects a payment for an already expired booking', async () => {
      const flight = await seedFlight();
      const { body } = await hold([flight]).expect(201);
      await service.cancelBookingsForFlight(flight.flightId);

      await assert.rejects(service.confirmPaidBooking(body.flightBookingId, new Types.ObjectId().toString()), ConflictException);
    });

    it('gives Payments the amount and hold for a payable booking', async () => {
      const flight = await seedFlight();
      const { body } = await hold([flight]).expect(201);
      const payable = await service.getPayableBooking(body.flightBookingId, body.userId);
      assert.equal(payable.amount, ECONOMY_FARE);
      assert.equal(payable.currency, 'USD');
    });

    it('serves a PDF e-ticket only after confirmation', async () => {
      const flight = await seedFlight();
      const { body } = await hold([flight]).expect(201);
      const url = `/api/flight-bookings/${body.flightBookingId}/e-ticket`;
      await request(app.getHttpServer()).get(url).set('Cookie', traveler).expect(409);

      await service.confirmPaidBooking(body.flightBookingId, new Types.ObjectId().toString());

      const ticket = await request(app.getHttpServer()).get(url).set('Cookie', traveler).buffer().parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      }).expect(200);
      assert.equal(ticket.headers['content-type'], 'application/pdf');
      assert.equal((ticket.body as Buffer).subarray(0, 5).toString(), '%PDF-');
    });
  });

  describe('FLT-25 viewing and ownership (ACC-11)', () => {
    it('groups bookings as Upcoming, Past and Cancelled', async () => {
      const upcoming = await confirmedBooking(await seedFlight());
      const past = await confirmedBooking(await seedFlight());
      await bookings.updateOne({ _id: past }, { $set: { lastDepartureAt: new Date(Date.now() - DAY_MS) } }).exec();
      await service.completeDepartedBookings();
      const cancelled = await confirmedBooking(await seedFlight());
      await request(app.getHttpServer()).post(`/api/flight-bookings/${cancelled}/cancel`).set('Cookie', traveler).expect(200);

      const list = async (group: string) => (await request(app.getHttpServer())
        .get(`/api/flight-bookings?group=${group}`).set('Cookie', traveler).expect(200)).body;

      assert.deepEqual((await list('UPCOMING')).items.map((item: { flightBookingId: string }) => item.flightBookingId), [upcoming]);
      assert.deepEqual((await list('PAST')).items.map((item: { flightBookingId: string }) => item.flightBookingId), [past]);
      assert.deepEqual((await list('CANCELLED')).items.map((item: { flightBookingId: string }) => item.flightBookingId), [cancelled]);
      await request(app.getHttpServer()).get('/api/flight-bookings?group=OTHER').set('Cookie', traveler).expect(400);
    });

    it('paginates at 10 rows (GEN-05)', async () => {
      const flight = await seedFlight({ seats: 20 });
      for (let index = 0; index < 11; index += 1) await hold([flight]).expect(201);

      const first = await request(app.getHttpServer()).get('/api/flight-bookings').set('Cookie', traveler).expect(200);
      const second = await request(app.getHttpServer()).get('/api/flight-bookings?page=2').set('Cookie', traveler).expect(200);

      assert.equal(first.body.items.length, 10);
      assert.equal(first.body.total, 11);
      assert.equal(second.body.items.length, 1);
    });

    it('hides other users\' bookings behind 404 on every route', async () => {
      const id = await confirmedBooking(await seedFlight());
      const intruder = await login('intruder@example.com');
      const server = app.getHttpServer();

      await request(server).get(`/api/flight-bookings/${id}`).set('Cookie', intruder).expect(404);
      await request(server).get(`/api/flight-bookings/${id}/cancellation-quote`).set('Cookie', intruder).expect(404);
      await request(server).get(`/api/flight-bookings/${id}/e-ticket`).set('Cookie', intruder).expect(404);
      await request(server).post(`/api/flight-bookings/${id}/cancel`).set('Cookie', intruder).expect(404);
      const list = await request(server).get('/api/flight-bookings').set('Cookie', intruder).expect(200);
      assert.equal(list.body.total, 0);
      assert.equal((await bookings.findById(id).orFail().exec()).status, BookingStatus.CONFIRMED);
    });

    it('returns 404 for a malformed booking ID', async () => {
      await request(app.getHttpServer()).get('/api/flight-bookings/not-an-id').set('Cookie', traveler).expect(404);
    });
  });

  describe('FLT-26 cancellation', () => {
    const cancel = (id: string) => request(app.getHttpServer()).post(`/api/flight-bookings/${id}/cancel`).set('Cookie', traveler);
    const quote = (id: string) => request(app.getHttpServer()).get(`/api/flight-bookings/${id}/cancellation-quote`).set('Cookie', traveler);

    for (const [days, percentage] of [[20, 100], [10, 50], [2, 10]] as const) {
      it(`refunds ${percentage}% with ${days} days remaining`, async () => {
        const flight = await seedFlight({ departsInDays: days });
        const id = await confirmedBooking(flight);

        assert.equal((await quote(id).expect(200)).body.refundPercentage, percentage);
        const response = await cancel(id).expect(200);

        assert.equal(response.body.status, BookingStatus.CANCELLED);
        assert.equal(response.body.refundAmount, ECONOMY_FARE * percentage / 100);
        assert.ok(response.body.refundId);
        assert.deepEqual(await seats(flight.cabinId), { held: 0, booked: 0 });
        assert.equal(payments.refunds[0].amount, ECONOMY_FARE * percentage / 100);
      });
    }

    it('makes no refund request when no tier applies', async () => {
      await connection.collection('airlines').updateOne({ _id: airlineId }, { $set: { cancellationTiers: [{ daysBeforeDeparture: 30, refundPercentage: 100 }] } });
      const response = await cancel(await confirmedBooking(await seedFlight({ departsInDays: 10 }))).expect(200);

      assert.equal(response.body.refundAmount, 0);
      assert.equal(payments.refunds.length, 0);
    });

    it('uses the outbound tier for a round trip and releases both cabins', async () => {
      const outbound = await seedFlight({ departsInDays: 10 });
      const inbound = await seedFlight({ from: dubai, to: cairo, departsInDays: 40 });
      const held = await hold([outbound, inbound]).expect(201);
      await service.confirmPaidBooking(held.body.flightBookingId, new Types.ObjectId().toString());

      const response = await cancel(held.body.flightBookingId).expect(200);

      assert.equal(response.body.refundAmount, ECONOMY_FARE);
      assert.deepEqual(await seats(outbound.cabinId), { held: 0, booked: 0 });
      assert.deepEqual(await seats(inbound.cabinId), { held: 0, booked: 0 });
    });

    it('releases seats and refunds once under concurrent cancels', async () => {
      const flight = await seedFlight({ departsInDays: 20 });
      const id = await confirmedBooking(flight);
      await hold([flight], [adult()]).expect(201);
      await confirmedBooking(flight);

      const responses = await Promise.all([cancel(id), cancel(id), cancel(id)]);

      assert.equal(responses.filter(({ status }) => status === 200).length, 1);
      assert.equal(responses.filter(({ status }) => status === 409).length, 2);
      assert.deepEqual(await seats(flight.cabinId), { held: 1, booked: 1 });
      assert.equal(payments.refunds.length, 1);
    });

    it('blocks cancellation after departure and of unconfirmed bookings', async () => {
      const flight = await seedFlight();
      const id = await confirmedBooking(flight);
      await connection.collection('flights').updateOne({ _id: new Types.ObjectId(flight.flightId) }, { $set: { departureAt: new Date(Date.now() - 1000) } });
      await cancel(id).expect(409);
      await quote(id).expect(409);

      const pending = await hold([await seedFlight()]).expect(201);
      await cancel(pending.body.flightBookingId).expect(409);
    });

    it('shows the refund status from Payments on the booking details (PAY-03)', async () => {
      const id = await confirmedBooking(await seedFlight({ departsInDays: 20 }));
      const before = await request(app.getHttpServer()).get(`/api/flight-bookings/${id}`).set('Cookie', traveler).expect(200);
      assert.equal(before.body.refund, undefined);

      const cancelled = await cancel(id).expect(200);
      assert.equal(cancelled.body.refund.status, 'PENDING');
      payments.statuses.get(id)!.status = 'REFUNDED';
      const after = await request(app.getHttpServer()).get(`/api/flight-bookings/${id}`).set('Cookie', traveler).expect(200);
      assert.deepEqual(after.body.refund, { ...payments.statuses.get(id) });
    });

    it('still loads the details when Payments cannot report the refund status', async () => {
      const id = await confirmedBooking(await seedFlight({ departsInDays: 20 }));
      await cancel(id).expect(200);
      const original = payments.getRefundStatus;
      payments.getRefundStatus = async () => { throw new Error('Payments unavailable'); };
      try {
        const response = await request(app.getHttpServer()).get(`/api/flight-bookings/${id}`).set('Cookie', traveler).expect(200);
        assert.equal(response.body.status, BookingStatus.CANCELLED);
        assert.equal(response.body.refund, undefined);
      } finally {
        payments.getRefundStatus = original;
      }
    });

    it('never commits a cancellation after departure when the policy lookup is slow (review F8)', async () => {
      const flight = await seedFlight();
      const id = await confirmedBooking(flight);
      const departureAt = new Date(Date.now() + 400);
      await connection.collection('flights').updateOne({ _id: new Types.ObjectId(flight.flightId) }, { $set: { departureAt } });
      await bookings.updateOne({ _id: id }, { $set: { 'segments.0.departureAt': departureAt, lastDepartureAt: departureAt } }).exec();
      const inventory = app.get<FlightInventoryPort>(FLIGHT_INVENTORY, { strict: false });
      const original = inventory.getAirlinePolicy;
      // The airline policy arrives only after the flight has departed.
      inventory.getAirlinePolicy = async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 800));
        return original.apply(inventory, args);
      };
      try {
        await cancel(id).expect(409);
      } finally {
        inventory.getAirlinePolicy = original;
      }

      const booking = await bookings.findById(id).orFail().exec();
      assert.equal(booking.status, BookingStatus.CONFIRMED);
      assert.deepEqual(await seats(flight.cabinId), { held: 0, booked: 1 });
      assert.equal(payments.refunds.length, 0);
    });

    it('keeps the cancellation and retries a failed refund', async () => {
      const id = await confirmedBooking(await seedFlight({ departsInDays: 20 }));
      payments.failNextRefund = true;

      const response = await cancel(id).expect(200);
      assert.equal(response.body.status, BookingStatus.CANCELLED);
      assert.equal(response.body.refundId, undefined);

      await maintenance.sweep();

      const booking = await bookings.findById(id).orFail().exec();
      assert.equal(booking.refundDue, false);
      assert.ok(booking.refundId);
      assert.equal(payments.refunds.length, 1);
    });
  });

  describe('Team integration', () => {
    it('FLT-06: refunds Confirmed bookings fully and releases holds', async () => {
      const flight = await seedFlight({ departsInDays: 2 });
      const confirmed = await confirmedBooking(flight);
      const pending = await hold([flight]).expect(201);

      await service.cancelBookingsForFlight(flight.flightId);

      const booking = await bookings.findById(confirmed).orFail().exec();
      assert.equal(booking.status, BookingStatus.CANCELLED);
      assert.equal(booking.cancelledBy, 'AIRLINE');
      assert.equal(booking.refundAmount, ECONOMY_FARE);
      assert.equal((await bookings.findById(pending.body.flightBookingId).orFail().exec()).status, BookingStatus.EXPIRED);
      assert.deepEqual(await seats(flight.cabinId), { held: 0, booked: 0 });
      assert.ok(notifications.sent.some(({ type }) => type === 'BOOKING_CANCELLED'));
    });

    it('FLT-05: keeps stored times current and finds who to notify', async () => {
      const flight = await seedFlight();
      const id = await confirmedBooking(flight);
      const departureAt = new Date(flight.departureAt.getTime() + DAY_MS);
      const arrivalAt = new Date(departureAt.getTime() + 60_000);

      await service.syncFlightSchedule(flight.flightId, departureAt, arrivalAt);

      const booking = await bookings.findById(id).orFail().exec();
      assert.equal(booking.segments[0].departureAt.getTime(), departureAt.getTime());
      assert.equal(booking.lastDepartureAt.getTime(), departureAt.getTime());
      assert.deepEqual(await service.findConfirmedUserIdsForFlight(flight.flightId), [booking.userId.toString()]);
    });

    it('FLT-29: lists a flight\'s bookings without passport numbers', async () => {
      const flight = await seedFlight();
      await confirmedBooking(flight);
      await hold([flight]).expect(201);

      const result = await service.listBookingsForFlight(flight.flightId);

      assert.equal(result.total, 1);
      assert.deepEqual(result.items[0].passengerNames, ['Alex Traveler']);
      assert.ok(!JSON.stringify(result).includes('A12345678'));
    });

    it('ACC-15: lists customers with Confirmed bookings on an airline', async () => {
      const id = await confirmedBooking(await seedFlight());
      await hold([await seedFlight()]).expect(201);
      const { userId } = await bookings.findById(id).orFail().exec();

      assert.deepEqual(await service.listConfirmedUserIdsForAirline(airlineId.toString()), [userId.toString()]);
      assert.deepEqual(await service.listConfirmedUserIdsForAirline(new Types.ObjectId().toString()), []);
    });

    it('treats a payment replay after completion as already confirmed', async () => {
      const flight = await seedFlight();
      const { body } = await hold([flight]).expect(201);
      const paymentId = new Types.ObjectId().toString();
      await service.confirmPaidBooking(body.flightBookingId, paymentId);
      await bookings.updateOne({ _id: body.flightBookingId }, { $set: { lastDepartureAt: new Date(Date.now() - 1000) } }).exec();
      await service.completeDepartedBookings();

      await service.confirmPaidBooking(body.flightBookingId, paymentId);

      assert.equal((await bookings.findById(body.flightBookingId).orFail().exec()).status, BookingStatus.COMPLETED);
      assert.equal(notifications.sent.length, 1);
    });

    it('ACC-12: reports upcoming Confirmed bookings', async () => {
      const id = await confirmedBooking(await seedFlight());
      const { userId } = await bookings.findById(id).orFail().exec();

      assert.equal(await service.hasUpcomingConfirmedBookings(userId.toString()), true);
      await request(app.getHttpServer()).post(`/api/flight-bookings/${id}/cancel`).set('Cookie', traveler).expect(200);
      assert.equal(await service.hasUpcomingConfirmedBookings(userId.toString()), false);
    });

    it('ACC-17: filters the admin view by status', async () => {
      await confirmedBooking(await seedFlight());
      await hold([await seedFlight()]).expect(201);

      const result = await service.listForAdmin({ status: BookingStatus.CONFIRMED });

      assert.equal(result.total, 1);
      assert.ok(result.items[0].bookingReference);
    });

    it('GEN-11: completes Confirmed bookings after the last departure', async () => {
      const id = await confirmedBooking(await seedFlight());
      await bookings.updateOne({ _id: id }, { $set: { lastDepartureAt: new Date(Date.now() - 1000) } }).exec();

      await maintenance.sweep();

      assert.equal((await bookings.findById(id).orFail().exec()).status, BookingStatus.COMPLETED);
    });

    it('documents every route in Swagger', async () => {
      const { body } = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
      for (const path of ['/api/flight-bookings', '/api/flight-bookings/hold', '/api/flight-bookings/{id}', '/api/flight-bookings/{id}/cancellation-quote', '/api/flight-bookings/{id}/cancel', '/api/flight-bookings/{id}/e-ticket']) {
        assert.ok(body.paths[path], `${path} is missing`);
      }
    });
  });
});
