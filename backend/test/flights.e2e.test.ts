import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { AirportsService } from '../src/airports/airports.service';
import { Airline } from '../src/airlines/schemas/airline.schema';
import { UserRole } from '../src/common/enums/user-role.enum';
import { validateEnvironment } from '../src/config/validate-environment';
import { configureApplication } from '../src/configure-application';
import { FlightBookingsMaintenanceService } from '../src/flight-bookings/flight-bookings-maintenance.service';
import { CabinInventory } from '../src/flights/schemas/cabin-inventory.schema';
import { Flight } from '../src/flights/schemas/flight.schema';
import { User } from '../src/users/schemas/user.schema';

describe('Production module flight registration and atomic cabin creation', { concurrency: false }, () => {
  let replicaSet: MongoMemoryReplSet | undefined;
  let app: INestApplication;
  let connection: Connection;
  let users: Model<User>;
  let airlines: Model<Airline>;
  let flights: Model<Flight>;
  let cabins: Model<CabinInventory>;
  let moderator: { userId: string; cookie: string };
  let otherModerator: { userId: string; cookie: string };
  let unassigned: { userId: string; cookie: string };
  let traveler: { userId: string; cookie: string };
  let admin: { userId: string; cookie: string };
  let airlineId: Types.ObjectId;
  const futureDate = `${new Date().getUTCFullYear() + 1}-12-10`;
  const http = () => request(app.getHttpServer());

  const flightInput = (flightNumber = 'QA100') => ({
    flightNumber, departureAirportCode: 'CAI', arrivalAirportCode: 'DXB',
    departureLocalDateTime: `${futureDate}T14:00`, arrivalLocalDateTime: `${futureDate}T18:00`,
  });
  const cabin = (cabinClass: string) => ({
    cabinClass, totalSeats: 20, price: 10000, baggageAllowanceCount: 1, baggageMaxWeightKg: 23,
  });

  async function login(email: string, role: UserRole) {
    const password = `${randomBytes(16).toString('hex')}A1`;
    const registered = await http().post('/api/auth/register')
      .send({ name: 'Synthetic flight reviewer', email, password, termsAccepted: true }).expect(201);
    await users.updateOne({ email }, { $set: { role } }).exec();
    const response = await http().post('/api/auth/login').send({ email, password }).expect(200);
    const cookies = response.headers['set-cookie'] as unknown as string[];
    return { userId: registered.body.userId as string, cookie: cookies.map((value) => value.split(';')[0]).join('; ') };
  }

  async function createFlight() {
    const response = await http().post('/api/flights').set('Cookie', moderator.cookie).send(flightInput()).expect(201);
    return response.body._id as string;
  }

  const addCabins = (flightId: string, classes: string[], cookie = moderator.cookie) =>
    http().post(`/api/flights/${flightId}/cabins`).set('Cookie', cookie).send({ cabins: classes.map(cabin) });

  before(async () => {
    replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    const values = validateEnvironment({
      MONGODB_URI: replicaSet.getUri('flight-creation'), JWT_SECRET: randomBytes(48).toString('hex'), PORT: '3000',
    });
    // Import the real AppModule only after replacing its environment loader. This
    // tests its actual feature imports without reading .env or process secrets.
    const originalForRoot = ConfigModule.forRoot.bind(ConfigModule);
    const configStub = mock.method(ConfigModule, 'forRoot', () => originalForRoot({
      isGlobal: true, ignoreEnvFile: true, skipProcessEnv: true, load: [() => values],
    }));
    try {
      const { AppModule } = await import('../src/app.module');
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(FlightBookingsMaintenanceService).useValue({})
        .compile();
      app = moduleRef.createNestApplication();
      configureApplication(app);
      await app.init();
      assert.equal(configStub.mock.callCount(), 1, 'the root environment loader was replaced before importing AppModule');
      connection = moduleRef.get(getConnectionToken());
      assert.ok(connection.host === '127.0.0.1', 'root module must use the isolated local database');
      users = moduleRef.get(getModelToken(User.name));
      airlines = moduleRef.get(getModelToken(Airline.name));
      flights = moduleRef.get(getModelToken(Flight.name));
      cabins = moduleRef.get(getModelToken(CabinInventory.name));
      await Promise.all([users.init(), airlines.init(), flights.init(), cabins.init()]);
      await moduleRef.get(AirportsService).seedPredefined();
    } finally {
      configStub.mock.restore();
    }
    moderator = await login('flight-owner@example.com', UserRole.AIRLINE_MODERATOR);
    otherModerator = await login('flight-other@example.com', UserRole.AIRLINE_MODERATOR);
    unassigned = await login('flight-unassigned@example.com', UserRole.AIRLINE_MODERATOR);
    traveler = await login('flight-traveler@example.com', UserRole.USER);
    admin = await login('flight-admin@example.com', UserRole.ADMIN);
  }, { timeout: 90_000 });

  beforeEach(async () => {
    await cabins.deleteMany({}).exec();
    await flights.deleteMany({}).exec();
    await airlines.deleteMany({}).exec();
    await connection.collection('moderatorassignments').deleteMany({});
    const first = await airlines.create({ name: 'Synthetic Airline A', code: 'QA' });
    const other = await airlines.create({ name: 'Synthetic Airline B', code: 'QB' });
    airlineId = first._id;
    await connection.collection('moderatorassignments').insertMany([
      { moderatorId: new Types.ObjectId(moderator.userId), airlineId },
      { moderatorId: new Types.ObjectId(otherModerator.userId), airlineId: other._id },
    ]);
  });

  after(async () => {
    await app?.close();
    await replicaSet?.stop();
  });

  it('registers both routes in the real root module and Swagger, with authentication/role guards', async () => {
    const doc = (await http().get('/api/docs-json').expect(200)).body;
    assert.equal(cabins.schema.path('flightId').instance, 'ObjectId');
    for (const field of ['airlineId', 'departureAirportId', 'arrivalAirportId']) {
      assert.equal(flights.schema.path(field).instance, 'ObjectId');
    }
    assert.ok(doc.paths['/api/flights'].post);
    assert.ok(doc.paths['/api/flights/{flightId}/cabins'].post);
    assert.ok(doc.paths['/api/flights/{flightId}/cabins'].post.responses['409']);
    await http().post('/api/flights').send(flightInput()).expect(401);
    for (const actor of [traveler, admin]) {
      await http().post('/api/flights').set('Cookie', actor.cookie).send(flightInput()).expect(403);
    }
    await http().post('/api/flights').set('Cookie', unassigned.cookie).send(flightInput()).expect(403);
    const id = await createFlight();
    const stored = await flights.findById(id).orFail().lean().exec();
    assert.equal(stored.airlineId.toString(), airlineId.toString());
    assert.equal(stored.departureAt.toISOString(), `${futureDate}T12:00:00.000Z`);
    assert.equal(stored.arrivalAt.toISOString(), `${futureDate}T14:00:00.000Z`);
    await http().post('/api/flights').set('Cookie', moderator.cookie).send(flightInput()).expect(409);
  });

  it('rejects invalid flight requests and inactive assigned airlines without storing a flight', async () => {
    for (const changes of [
      { arrivalAirportCode: 'CAI' }, { arrivalAirportCode: 'XXX' },
      { arrivalLocalDateTime: `${futureDate}T10:00` }, { departureLocalDateTime: '2000-01-01T14:00' },
    ]) {
      await http().post('/api/flights').set('Cookie', moderator.cookie).send({ ...flightInput(), ...changes }).expect(400);
    }
    await airlines.updateOne({ _id: airlineId }, { $set: { isActive: false } }).exec();
    await http().post('/api/flights').set('Cookie', moderator.cookie).send(flightInput()).expect(403);
    assert.equal(await flights.countDocuments(), 0);
  });

  it('creates valid cabin batches and rejects wrong owners, roles, statuses and invalid classes', async () => {
    const id = await createFlight();
    await http().post(`/api/flights/${id}/cabins`).send({ cabins: [cabin('ECONOMY')] }).expect(401);
    await addCabins(id, ['ECONOMY'], traveler.cookie).expect(403);
    await addCabins(id, ['ECONOMY'], otherModerator.cookie).expect(404);
    await addCabins(id, ['ECONOMY'], unassigned.cookie).expect(403);
    await addCabins('not-an-id', ['ECONOMY']).expect(404);
    await addCabins(id, ['NOT_A_CABIN']).expect(400);
    await addCabins(id, ['ECONOMY', 'ECONOMY']).expect(400);
    assert.equal(await cabins.countDocuments(), 0);
    const response = await addCabins(id, ['ECONOMY', 'BUSINESS']).expect(201);
    assert.equal(response.body.length, 2);
    assert.ok(response.body.every((row: CabinInventory) => row.heldSeats === 0 && row.bookedSeats === 0));
    await flights.updateOne({ _id: id }, { $set: { status: 'CANCELLED' } }).exec();
    await addCabins(id, ['FIRST']).expect(409);
    assert.equal(await cabins.countDocuments(), 2);
  });

  it('rolls back an earlier insert when a later class conflicts with existing inventory', async () => {
    const id = await createFlight();
    await addCabins(id, ['ECONOMY']).expect(201);
    await addCabins(id, ['BUSINESS', 'ECONOMY']).expect(409);
    const stored = await cabins.find({ flightId: new Types.ObjectId(id) }).lean().exec();
    assert.deepEqual(stored.map(({ cabinClass }) => cabinClass), ['ECONOMY']);
    assert.equal(stored[0].totalSeats, 20);
    assert.equal(stored[0].heldSeats, 0);
    assert.equal(stored[0].bookedSeats, 0);
  });

  it('commits exactly one overlapping concurrent batch and leaves none of the losing batch', { timeout: 30_000 }, async () => {
    const id = await createFlight();
    const results = await Promise.all([
      addCabins(id, ['BUSINESS', 'ECONOMY']), addCabins(id, ['FIRST', 'ECONOMY']),
    ]);
    assert.deepEqual(results.map(({ status }) => status).sort(), [201, 409]);
    const winner = results[0].status === 201 ? 'BUSINESS' : 'FIRST';
    const stored = await cabins.find({ flightId: new Types.ObjectId(id) }).sort({ cabinClass: 1 }).lean().exec();
    assert.deepEqual(stored.map(({ cabinClass }) => cabinClass).sort(), ['ECONOMY', winner].sort());
  });
});
