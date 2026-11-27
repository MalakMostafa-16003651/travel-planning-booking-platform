#!/usr/bin/env node
'use strict';

/**
 * Disposable backend for the itinerary browser checks (Person 7): the real compiled Nest
 * application on a throwaway MongoDB replica set, with the official reference catalog
 * (countries, cities, attractions, currencies) seeded. It never reads .env, Atlas, mail,
 * Stripe or the FX provider. Build first, from backend/: npm run build
 */
const { createRequire } = require('node:module');
const { join, resolve } = require('node:path');
const { randomBytes } = require('node:crypto');
const { mailEnvironment, installMailFixture } = require('./auth-mail-fixture.cjs');

const backendDirectory = resolve(__dirname, '../../backend');
const backendRequire = createRequire(join(backendDirectory, 'package.json'));
const port = Number(process.env.PORT || 3120);
const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:3121';
const PASSWORD = 'M2SmokeOnly2026'; // Disposable local accounts only.

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
  const { Types } = backendRequire('mongoose');
  const { Test } = backendRequire('@nestjs/testing');

  replicaSet = await MongoMemoryReplSet.create({
    binary: { downloadDir: join(backendDirectory, 'node_modules/.cache/mongodb-binaries') },
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  Object.assign(process.env, {
    MONGODB_URI: replicaSet.getUri('m2-itineraries'),
    JWT_SECRET: randomBytes(48).toString('hex'),
    PORT: String(port),
    FXRATES_API_KEY: '',
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    ...mailEnvironment(frontendOrigin),
  });

  const originalForRoot = ConfigModule.forRoot;
  ConfigModule.forRoot = function (options) { return originalForRoot.call(this, { ...options, ignoreEnvFile: true }); };
  let AppModule;
  try { ({ AppModule } = backendRequire('./dist/app.module.js')); } finally { ConfigModule.forRoot = originalForRoot; }
  const { configureApplication } = backendRequire('./dist/configure-application.js');
  const { PasswordService } = backendRequire('./dist/auth/password.service.js');
  const { ReferenceDataService } = backendRequire('./dist/reference-data/reference-data.service.js');
  const { CurrenciesService } = backendRequire('./dist/currencies/currencies.service.js');
  const { AIRPORT_SEEDS } = backendRequire('./dist/airports/airport-seeds.js');
  const { FxRatesClient, FxRatesUnavailableError } = backendRequire('./dist/itineraries/currency/fx-rates.client.js');

  const builder = Test.createTestingModule({ imports: [AppModule] });
  installMailFixture(backendRequire, builder);
  // Only the external FXRatesAPI call is replaced: it is always "down", so conversions use the
  // backend's real cache logic with rates seeded below (fresh today, or stale from yesterday).
  builder.overrideProvider(FxRatesClient).useValue({ latest: async () => { throw new FxRatesUnavailableError('Provider disabled in the itinerary fixture'); } });
  const testing = await builder.compile();
  app = testing.createNestApplication({ rawBody: true, logger: false });
  configureApplication(app);
  const connection = testing.get(getConnectionToken());

  const airports = {};
  const airlineId = new Types.ObjectId();

  const controls = {
    /** ITN-25: an active hotel with bookable rooms (price in cents per night). */
    async hotel({ name, city = 'Cairo', countryCode = 'EG', rooms = '2', capacity = '2', price = '9000' }) {
      const hotel = await connection.models.Hotel.create({
        name, city, countryCode, address: '1 Test Street', checkInTime: '15:00', checkOutTime: '12:00',
        cancellationTiers: [{ daysBeforeCheckIn: 2, refundPercentage: 100 }],
      });
      const roomIds = [];
      for (let index = 0; index < Number(rooms); index += 1) {
        const room = await connection.models.Room.create({ hotelId: hotel._id, name: `Room ${index + 1}`, capacity: Number(capacity), pricePerNight: Number(price) });
        roomIds.push(String(room._id));
        await connection.collection('roomavailabilities').updateOne({ roomId: room._id }, {
          $set: { bookableRanges: [{ startDate: '2020-01-01', endDate: '2100-01-01' }] },
          $setOnInsert: { roomId: room._id, hotelId: hotel._id, blockedRanges: [], bookedRanges: [] },
        }, { upsert: true });
      }
      return { hotelId: String(hotel._id), roomIds };
    },
    /** ITN-26: a scheduled flight on an airport-local date (YYYY-MM-DD), departing at `hour` UTC. */
    async flight({ from, to, date, hour = '8', price = '15000', seats = '10', number }) {
      const departureAt = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);
      const local = new Intl.DateTimeFormat('en-CA', { timeZone: airports[from].timeZone }).format(departureAt);
      const flight = await connection.models.Flight.create({
        airlineId, flightNumber: number || `MS${Math.floor(Math.random() * 9000) + 1000}`, status: 'SCHEDULED',
        departureAirportId: airports[from]._id, arrivalAirportId: airports[to]._id, departureLocalDate: local,
        departureAt, arrivalAt: new Date(departureAt.getTime() + 4 * 3_600_000),
      });
      const cabin = await connection.models.CabinInventory.create({
        flightId: flight._id, cabinClass: 'ECONOMY', totalSeats: Number(seats), bookedSeats: 0, heldSeats: 0,
        price: Number(price), baggageAllowanceCount: 1, baggageMaxWeightKg: 23,
      });
      return { flightId: String(flight._id), cabinId: String(cabin._id), flightNumber: flight.flightNumber };
    },
    async user({ name = 'Kiki Planner', role = 'USER' }) {
      const email = `m2-itn-${randomBytes(6).toString('hex')}@example.test`;
      await connection.models.User.create({
        name, email, role, status: 'ACTIVE', mustChangePassword: false, termsAcceptedAt: new Date(), emailVerifiedAt: new Date(),
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
      });
      return { email, password: PASSWORD };
    },
    /**
     * ITN-27: marks a real hold (created through the booking API) as paid, as the verified
     * Stripe webhook would, so it can be linked. type is FLIGHT or HOTEL.
     */
    async confirm({ type, id }) {
      const collection = type === 'FLIGHT' ? 'flightbookings' : 'hotelbookings';
      const result = await connection.collection(collection).updateOne(
        { _id: new Types.ObjectId(id), status: 'PENDING' },
        { $set: { status: 'CONFIRMED', bookingReference: `ITN${randomBytes(3).toString('hex').toUpperCase()}` }, $unset: { holdExpiresAt: '' } },
      );
      if (result.matchedCount !== 1) throw new Error('No pending booking with that id');
      return {};
    },
    /** Revokes every session of a user, as a server-side expiry or sign-out elsewhere would. */
    async 'end-sessions'({ email }) {
      const user = await connection.models.User.findOne({ email });
      await connection.models.AuthSession.updateMany({ userId: user._id }, { $set: { revokedAt: new Date() } });
      return {};
    },
    /** Caches rates for `base`: units of each currency per one `base`, e.g. rates={"EGP":50}. */
    async rates({ base, rates, stale = 'false' }) {
      const fetchedAt = new Date(Date.now() - (stale === 'true' ? 2 * 86_400_000 : 0));
      await connection.collection('exchangerates').updateOne(
        { baseCurrency: base },
        { $set: { rates: JSON.parse(rates), rateDate: new Date(`${fetchedAt.toISOString().slice(0, 10)}T00:00:00Z`), fetchedAt, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
      );
      return {};
    },
  };

  const server = app.getHttpAdapter().getInstance();
  server.post('/__m2-itinerary-fixture/:control', async (request, response) => {
    const control = controls[request.params.control];
    if (request.socket.remoteAddress !== '127.0.0.1' || request.get('X-M2-Itinerary-Fixture') !== 'itineraries' || !control) {
      response.sendStatus(404);
      return;
    }
    try { response.json(await control(request.query)); } catch (error) { response.status(500).json({ message: String(error && error.message) }); }
  });

  await app.init();
  await Promise.all(Object.values(connection.models).map((model) => model.init()));
  await app.get(ReferenceDataService).seedSupported();
  await app.get(CurrenciesService).seedSupported();
  for (const airport of await connection.models.Airport.insertMany(AIRPORT_SEEDS.map((seed) => ({ ...seed })))) airports[airport.code] = airport;
  await connection.models.Airline.create({
    _id: airlineId, name: 'Nile Air', code: 'MS', isActive: true,
    baggagePolicy: { pricePerExtraBag: 3000, maxExtraBagsPerPassenger: 2 },
    cancellationTiers: [{ daysBeforeDeparture: 0, refundPercentage: 10 }, { daysBeforeDeparture: 21, refundPercentage: 100 }],
  });

  await app.listen(port, '127.0.0.1');
  process.stdout.write(`Disposable itinerary backend ready at http://localhost:${port}\n`);
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop().then(() => process.exit(0)); });

void main().catch(async (error) => {
  process.stderr.write(`Itinerary fixture failed to start: ${error && error.message}\n`);
  await stop();
  process.exitCode = 1;
});
