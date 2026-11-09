import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { INestApplication, Type } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request, { Response } from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { UserRole } from '../src/common/enums/user-role.enum';
import { configureApplication } from '../src/configure-application';
import { FlightBookingsModule } from '../src/flight-bookings/flight-bookings.module';
import { FlightBookingsService } from '../src/flight-bookings/flight-bookings.service';
import { BOOKING_NOTIFICATIONS, BookingNotification } from '../src/flight-bookings/ports/booking-notifications.port';
import { BOOKING_PAYMENTS, BookingPaymentsPort, RefundRequest } from '../src/flight-bookings/ports/booking-payments.port';
import { BookingPaymentsAdapter } from '../src/payments/adapters/booking-payments.adapter';
import { PaymentsModule } from '../src/payments/payments.module';
import { User, UserDocument } from '../src/users/schemas/user.schema';

const DAY_MS = 24 * 60 * 60 * 1000;
export const FARE = 15000; // 150.00 USD in the flight module's minor units.
export const PASSWORD = 'Travel123';

export class FakeNotifications {
  sent: BookingNotification[] = [];

  async notify(notification: BookingNotification) {
    this.sent.push(notification);
  }
}

function cookiesFrom(response: Response): string {
  const header = response.headers['set-cookie'] as unknown as string[];
  return header.map((cookie) => cookie.split(';')[0]).join('; ');
}

/**
 * The real Auth, FlightBookings and Payments modules on an isolated replica set
 * (flight bookings use transactions). Never reads .env or touches Atlas.
 */
export class PaymentsFixture {
  replicaSet!: MongoMemoryReplSet;
  app!: INestApplication;
  connection!: Connection;
  users!: Model<UserDocument>;
  flightBookings!: FlightBookingsService;
  readonly notifications = new FakeNotifications();
  // Binds Person 4's BOOKING_PAYMENTS to Payments, as FlightBookingsModule will once Person 4 agrees.
  private bookingPayments?: BookingPaymentsPort;
  private readonly paymentsBridge: BookingPaymentsPort = {
    cancelPendingPayment: (request) => this.bookingPayments!.cancelPendingPayment(request),
    createRefund: (request: RefundRequest) => this.bookingPayments!.createRefund(request),
  };
  readonly airlineId = new Types.ObjectId();
  private readonly cairo = new Types.ObjectId();
  private readonly dubai = new Types.ObjectId();

  async start(dbName: string, configure: (builder: TestingModuleBuilder) => TestingModuleBuilder = (builder) => builder, config: Record<string, string> = {}, additionalModules: Type<unknown>[] = []) {
    this.replicaSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      binary: { downloadDir: resolve(process.cwd(), 'node_modules/.cache/mongodb-binaries') },
    });
    const builder = Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          skipProcessEnv: true,
          load: [() => ({ JWT_SECRET: randomBytes(48).toString('hex'), ...config })],
        }),
        MongooseModule.forRoot(this.replicaSet.getUri(dbName)),
        AuthModule,
        FlightBookingsModule,
        PaymentsModule,
        ...additionalModules,
      ],
    }).overrideProvider(BOOKING_NOTIFICATIONS).useValue(this.notifications)
      .overrideProvider(BOOKING_PAYMENTS).useValue(this.paymentsBridge);
    const moduleRef = await configure(builder).compile();
    this.app = moduleRef.createNestApplication({ rawBody: true });
    configureApplication(this.app);
    await this.app.init();
    this.connection = moduleRef.get(getConnectionToken());
    this.users = moduleRef.get(getModelToken(User.name));
    this.flightBookings = moduleRef.get(FlightBookingsService, { strict: false });
    this.bookingPayments = moduleRef.get(BookingPaymentsAdapter, { strict: false });
    // Build every unique index before the tests rely on it.
    await Promise.all(Object.values(this.connection.models).map((model) => model.init()));
  }

  async stop() {
    await this.app?.close();
    await this.replicaSet?.stop();
  }

  async reset() {
    const collections = await this.connection.db!.collections();
    await Promise.all(collections.map((collection) => collection.deleteMany({})));
    this.notifications.sent = [];
    await this.connection.collection('airports').insertMany([
      { _id: this.cairo, code: 'CAI', timeZone: 'Africa/Cairo' },
      { _id: this.dubai, code: 'DXB', timeZone: 'Asia/Dubai' },
    ]);
    await this.connection.collection('airlines').insertOne({
      _id: this.airlineId,
      isActive: true,
      baggagePolicy: { pricePerExtraBag: 3000, maxExtraBagsPerPassenger: 2 },
      cancellationTiers: [
        { daysBeforeDeparture: 0, refundPercentage: 10 },
        { daysBeforeDeparture: 7, refundPercentage: 50 },
      ],
    });
  }

  http() {
    return request(this.app.getHttpServer());
  }

  /** Registers and logs in a user through Person 1's real endpoints; returns the session cookies. */
  async login(email: string, role = UserRole.USER): Promise<{ cookie: string; userId: string }> {
    await this.http().post('/api/auth/register').send({ name: 'Test User', email, password: PASSWORD, termsAccepted: true }).expect(201);
    await this.users.updateOne({ email }, { $set: { role } }).exec();
    const response = await this.http().post('/api/auth/login').set('Sec-Fetch-Site', 'same-origin').send({ email, password: PASSWORD }).expect(200);
    return { cookie: cookiesFrom(response), userId: response.body.userId as string };
  }

  /** A flight with seats, held through Person 4's real hold endpoint: a PENDING booking. */
  async holdBooking(cookie: string): Promise<string> {
    const flightId = new Types.ObjectId();
    const cabinId = new Types.ObjectId();
    const departureAt = new Date(Date.now() + 30 * DAY_MS);
    await this.connection.collection('flights').insertOne({
      _id: flightId,
      airlineId: this.airlineId,
      flightNumber: 'MS100',
      status: 'SCHEDULED',
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + 4 * 60 * 60 * 1000),
      departureAirportId: this.cairo,
      arrivalAirportId: this.dubai,
    });
    await this.connection.collection('cabininventories').insertOne({
      _id: cabinId, flightId, cabinClass: 'ECONOMY', totalSeats: 10, heldSeats: 0, bookedSeats: 0, price: FARE, baggageMaxWeightKg: 23,
    });
    const held = await this.http().post('/api/flight-bookings/hold').set('Cookie', cookie).send({
      segments: [{ flightId: flightId.toString(), cabinId: cabinId.toString() }],
      passengers: [{ fullName: 'Alex Traveler', dateOfBirth: '1995-04-12', documentNumber: 'A12345678', type: 'ADULT' }],
    }).expect(201);
    return held.body.flightBookingId as string;
  }

  bookingStatus(flightBookingId: string) {
    return this.connection.collection('flightbookings').findOne({ _id: new Types.ObjectId(flightBookingId) }).then((booking) => booking?.status as string);
  }

  /** Ends the 10-minute hold without waiting for it. */
  expireHold(flightBookingId: string) {
    return this.connection.collection('flightbookings').updateOne(
      { _id: new Types.ObjectId(flightBookingId) },
      { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
    );
  }
}
