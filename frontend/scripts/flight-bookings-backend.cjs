#!/usr/bin/env node
'use strict';

/**
 * Disposable backend for the flight booking browser checks: the real compiled Nest application on a
 * throwaway MongoDB replica set. It never reads .env, Atlas, mail or Stripe. Stripe's network calls are
 * replaced by the backend's own FakeStripe, and webhooks are signed and verified as in production.
 *
 * Build first, from backend/: npm run build && npm run build:test
 */
const { createRequire } = require('node:module');
const { join, resolve } = require('node:path');
const { randomBytes } = require('node:crypto');
const { mailEnvironment, installMailFixture } = require('./auth-mail-fixture.cjs');

const backendDirectory = resolve(__dirname, '../../backend');
const backendRequire = createRequire(join(backendDirectory, 'package.json'));
const port = Number(process.env.PORT || 3110);
const PASSWORD = 'M2SmokeOnly2026'; // Disposable local accounts only.
const DAY_MS = 86_400_000;

let app;
let replicaSet;
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  await app?.close();
  await replicaSet?.stop();
}

async function main() {
  backendRequire('reflect-metadata');
  const { MongoMemoryReplSet } = backendRequire('mongodb-memory-server');
  const { ConfigModule } = backendRequire('@nestjs/config');
  const { getConnectionToken } = backendRequire('@nestjs/mongoose');
  const { Test } = backendRequire('@nestjs/testing');
  const { Types } = backendRequire('mongoose');
  const { FakeStripe, TEST_STRIPE_CONFIG } = backendRequire('./.test-dist/test/fake-stripe.js');

  replicaSet = await MongoMemoryReplSet.create({
    binary: { downloadDir: join(backendDirectory, 'node_modules/.cache/mongodb-binaries') },
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  Object.assign(process.env, {
    MONGODB_URI: replicaSet.getUri('m2-flight-bookings'),
    JWT_SECRET: randomBytes(48).toString('hex'),
    PORT: String(port),
    ...TEST_STRIPE_CONFIG,
    FXRATES_API_KEY: '',
    ...mailEnvironment('http://localhost:3111'),
  });

  const originalForRoot = ConfigModule.forRoot;
  ConfigModule.forRoot = function (options) { return originalForRoot.call(this, { ...options, ignoreEnvFile: true }); };
  let AppModule;
  try { ({ AppModule } = backendRequire('./dist/app.module.js')); } finally { ConfigModule.forRoot = originalForRoot; }
  const { configureApplication } = backendRequire('./dist/configure-application.js');
  const { PasswordService } = backendRequire('./dist/auth/password.service.js');
  const { StripeService } = backendRequire('./dist/payments/stripe.service.js');
  const { FlightBookingsMaintenanceService } = backendRequire('./dist/flight-bookings/flight-bookings-maintenance.service.js');
  const { AIRPORT_SEEDS } = backendRequire('./dist/airports/airport-seeds.js');

  const builder = Test.createTestingModule({ imports: [AppModule] });
  installMailFixture(backendRequire, builder);
  const testing = await builder.compile();
  app = testing.createNestApplication({ rawBody: true, logger: false });
  configureApplication(app);
  const connection = testing.get(getConnectionToken());
  const stripe = new FakeStripe();
  stripe.refundStatus = 'pending';
  stripe.install(app.get(StripeService));

  const airports = {};
  const airlineId = new Types.ObjectId();
  const collection = (name) => connection.collection(name);

  const controls = {
    async user({ name = 'Nour Hassan', role = 'USER', verified = 'true' }) {
      const email = `m2-${randomBytes(6).toString('hex')}@example.test`;
      await connection.models.User.create({
        name, email, role, status: 'ACTIVE', mustChangePassword: false, termsAcceptedAt: new Date(),
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        ...(verified === 'true' ? { emailVerifiedAt: new Date() } : {}),
      });
      return { email, password: PASSWORD };
    },
    async flight({ from = 'CAI', to = 'DXB', days = '30', hour = '8', price = '15000', seats = '10', cabinClass = 'ECONOMY', number }) {
      const base = new Date(Date.now() + Number(days) * DAY_MS);
      const departureAt = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), Number(hour)));
      const local = new Intl.DateTimeFormat('en-CA', { timeZone: airports[from].timeZone }).format(departureAt);
      const flight = await connection.models.Flight.create({
        airlineId, flightNumber: number || `MS${Math.floor(Math.random() * 9000) + 1000}`, status: 'SCHEDULED',
        departureAirportId: airports[from]._id, arrivalAirportId: airports[to]._id, departureLocalDate: local,
        departureAt, arrivalAt: new Date(departureAt.getTime() + 3.5 * 3_600_000),
      });
      const cabin = await connection.models.CabinInventory.create({
        flightId: flight._id, cabinClass, totalSeats: Number(seats), bookedSeats: 0, heldSeats: 0,
        price: Number(price), baggageAllowanceCount: 1, baggageMaxWeightKg: 23,
      });
      return { flightId: String(flight._id), cabinId: String(cabin._id), date: local, flightNumber: flight.flightNumber };
    },
    /** Stripe reports success: the same signed webhook the real service sends. */
    async paid({ intent }) {
      const { payload, signature } = FakeStripe.signedEvent('payment_intent.succeeded', stripe.succeed(intent));
      const response = await fetch(`http://127.0.0.1:${port}/api/payments/webhook`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body: payload,
      });
      return { status: response.status };
    },
    async refunded({ booking }) {
      const refund = await collection('refunds').findOne({ flightBookingId: new Types.ObjectId(booking) });
      const { payload, signature } = FakeStripe.signedEvent('refund.updated', stripe.setRefundStatus(refund.stripeRefundId, 'succeeded'));
      const response = await fetch(`http://127.0.0.1:${port}/api/payments/webhook`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body: payload,
      });
      return { status: response.status };
    },
    async 'hold-ends'({ booking, change, seconds = '-1' }) {
      const holdExpiresAt = new Date(Date.now() + Number(seconds) * 1000);
      if (change) await collection('flightbookingchanges').updateOne({ _id: new Types.ObjectId(change) }, { $set: { holdExpiresAt } });
      else await collection('flightbookings').updateOne({ _id: new Types.ObjectId(booking) }, { $set: { holdExpiresAt } });
      return {};
    },
    async sweep() {
      await app.get(FlightBookingsMaintenanceService, { strict: false }).sweep();
      return {};
    },
    async departs({ flight }) {
      const departureAt = new Date(Date.now() - 60_000);
      await collection('flights').updateOne({ _id: new Types.ObjectId(flight) }, { $set: { departureAt } });
      await collection('flightbookings').updateMany({ 'segments.flightId': new Types.ObjectId(flight) }, { $set: { 'segments.0.departureAt': departureAt, lastDepartureAt: departureAt } });
      return {};
    },
    async cabin({ id }) {
      const cabin = await collection('cabininventories').findOne({ _id: new Types.ObjectId(id) });
      return { held: cabin.heldSeats, booked: cabin.bookedSeats };
    },
    /** Copies a confirmed booking so list paging can be checked without ten payments. */
    async copies({ booking, count }) {
      const { _id, ...source } = await collection('flightbookings').findOne({ _id: new Types.ObjectId(booking) });
      await collection('flightbookings').insertMany(Array.from({ length: Number(count) }, (_, index) => ({
        ...source, bookingReference: `COPY${String(index).padStart(4, '0')}`,
      })));
      return {};
    },
    async 'end-sessions'({ email }) {
      const user = await connection.models.User.findOne({ email });
      await connection.models.AuthSession.updateMany({ userId: user._id }, { $set: { revokedAt: new Date() } });
      return {};
    },
  };

  const server = app.getHttpAdapter().getInstance();
  server.post('/__m2-booking-fixture/:control', async (request, response) => {
    const control = controls[request.params.control];
    if (request.socket.remoteAddress !== '127.0.0.1' || request.get('X-M2-Booking-Fixture') !== 'flight-bookings' || !control) {
      response.sendStatus(404);
      return;
    }
    try { response.json(await control(request.query)); } catch (error) { response.status(500).json({ message: String(error && error.message) }); }
  });

  await app.init();
  await Promise.all(Object.values(connection.models).map((model) => model.init()));
  for (const airport of await connection.models.Airport.insertMany(AIRPORT_SEEDS.map((seed) => ({ ...seed })))) airports[airport.code] = airport;
  await connection.models.Airline.create({
    _id: airlineId, name: 'Nile Air', code: 'MS', isActive: true,
    baggagePolicy: { pricePerExtraBag: 3000, maxExtraBagsPerPassenger: 2 },
    cancellationTiers: [
      { daysBeforeDeparture: 0, refundPercentage: 10 }, { daysBeforeDeparture: 7, refundPercentage: 50 }, { daysBeforeDeparture: 21, refundPercentage: 100 },
    ],
  });

  await app.listen(port, '127.0.0.1');
  process.stdout.write(`Disposable flight booking backend ready at http://localhost:${port}\n`);
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop().then(() => process.exit(0)); });

void main().catch(async (error) => {
  process.stderr.write(`Flight booking fixture failed to start: ${error && error.message}\n`);
  await stop();
  process.exitCode = 1;
});
