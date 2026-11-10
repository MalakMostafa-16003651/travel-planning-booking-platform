import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { INestApplication, NotFoundException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request, { Response } from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { AccountStatus } from '../src/common/enums/account-status.enum';
import { ReferenceDataService } from '../src/reference-data/reference-data.service';
import { AirportsService } from '../src/airports/airports.service';
import { UsersService } from '../src/users/users.service';
import { UserRole } from '../src/common/enums/user-role.enum';
import { CurrenciesService } from '../src/currencies/currencies.service';
import { configureApplication } from '../src/configure-application';
import { FxRatesClient, FxRatesUnavailableError } from '../src/itineraries/currency/fx-rates.client';
import { ItinerariesModule } from '../src/itineraries/itineraries.module';
import { ItinerariesService } from '../src/itineraries/itineraries.service';
import { ITINERARY_ACCOUNT_STATUSES, ItineraryAccountStatusesPort } from '../src/itineraries/ports/itinerary-authors.port';
import { BookingStatus } from '../src/common/enums/booking-status.enum';
import { ITINERARY_FLIGHT_BOOKINGS, ITINERARY_HOTEL_BOOKINGS, LinkableBooking } from '../src/itineraries/ports/itinerary-bookings.port';
import { ITINERARY_FLIGHT_SEARCH, ITINERARY_HOTEL_SEARCH, ItineraryFlightSearch, ItineraryHotelSearch } from '../src/itineraries/ports/travel-search.port';
import { Itinerary } from '../src/itineraries/schemas/itinerary.schema';
import { User, UserDocument } from '../src/users/schemas/user.schema';

/** USD-based rates: 1 USD = 50 EGP = 0.9 EUR. */
const USD_RATES: Record<string, number> = { EGP: 50, EUR: 0.9, GBP: 0.8, AED: 3.67, SAR: 3.75, JPY: 150 };

class FakeFxClient {
  calls = 0;
  fail = false;
  omit: string[] = [];

  async latest(base: string, symbols: string[]) {
    this.calls += 1;
    if (this.fail) throw new FxRatesUnavailableError('down');
    const perUsd = { USD: 1, ...USD_RATES } as Record<string, number>;
    const rates: Record<string, number> = {};
    for (const code of symbols) {
      if (!this.omit.includes(code) && perUsd[code]) rates[code] = perUsd[code] / perUsd[base];
    }
    return { base, rateDate: new Date('2026-11-04T00:00:00Z'), rates };
  }
}

class FakeSearch<C> {
  criteria: C[] = [];
  async search(criteria: C) {
    this.criteria.push(criteria);
    return { items: ['result'] };
  }
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);

function cookiesFrom(response: Response): string {
  const header = response.headers['set-cookie'] as unknown as string[];
  return header.map((cookie) => cookie.split(';')[0]).join('; ');
}

/** ITN-27: stands in for HotelBookingsService/FlightBookingsService.getMine (owner-only, 404 otherwise). */
class FakeBookings {
  rows = new Map<string, { userId: string; booking: LinkableBooking }>();
  fail = false;

  add(userId: string, changes: Partial<LinkableBooking> = {}): string {
    const bookingId = new Types.ObjectId().toString();
    this.rows.set(bookingId, {
      userId,
      booking: {
        status: BookingStatus.CONFIRMED, amountMinor: 25050, currency: 'USD', bookingReference: 'HB-TEST1',
        label: 'Nile Hotel', startDate: '2026-12-20', endDate: '2026-12-22', ...changes,
      },
    });
    return bookingId;
  }

  async getOwnBooking(bookingId: string, userId: string): Promise<LinkableBooking> {
    if (this.fail) throw new Error('hotel bookings unavailable');
    const row = this.rows.get(bookingId);
    if (!row || row.userId !== userId) throw new NotFoundException('Hotel booking not found');
    return { ...row.booking };
  }
}

describe('Itineraries, activities and budgeting', { concurrency: false }, () => {
  let mongo: MongoMemoryServer;
  let app: INestApplication;
  let connection: Connection;
  let users: Model<UserDocument>;
  let accountStatuses: ItineraryAccountStatusesPort;
  let itinerariesService: ItinerariesService;
  const fx = new FakeFxClient();
  const flights = new FakeSearch<ItineraryFlightSearch>();
  const hotels = new FakeSearch<ItineraryHotelSearch>();
  const hotelBookings = new FakeBookings();
  const flightBookings = new FakeBookings();
  let alice: string;
  let bob: string;

  const http = () => request(app.getHttpServer());

  async function login(email: string, changes: Partial<User> = {}): Promise<string> {
    await http().post('/api/auth/register').send({ name: email.split('@')[0], email, password: 'Travel123', termsAccepted: true }).expect(201);
    if (Object.keys(changes).length > 0) await users.updateOne({ email }, { $set: changes }).exec();
    const response = await http().post('/api/auth/login').set('Sec-Fetch-Site', 'same-origin').send({ email, password: 'Travel123' }).expect(200);
    return cookiesFrom(response);
  }

  const setStatus = (email: string, status: AccountStatus) => users.updateOne({ email }, { $set: { status } }).exec();

  async function createItinerary(cookie = alice, body: Record<string, unknown> = {}) {
    const response = await http().post('/api/itineraries').set('Cookie', cookie)
      .send({ title: 'Egypt trip', countries: ['EG', 'GB', 'FR', 'AE'], startDate: '2026-12-20', ...body }).expect(201);
    return response.body.itineraryId as string;
  }

  async function addDay(id: string, city: string, extra: Record<string, unknown> = {}, cookie = alice) {
    const response = await http().post(`/api/itineraries/${id}/days`).set('Cookie', cookie).send({ city, ...extra }).expect(201);
    return response.body;
  }

  before(async () => {
    mongo = await MongoMemoryServer.create({
      binary: { downloadDir: resolve(process.cwd(), 'node_modules/.cache/mongodb-binaries') },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true, ignoreEnvFile: true, skipProcessEnv: true,
          load: [() => ({ JWT_SECRET: randomBytes(48).toString('hex') })],
        }),
        MongooseModule.forRoot(mongo.getUri('itineraries')),
        AuthModule,
        ItinerariesModule,
      ],
    })
      .overrideProvider(FxRatesClient).useValue(fx)
      .overrideProvider(ITINERARY_FLIGHT_SEARCH).useValue(flights)
      .overrideProvider(ITINERARY_HOTEL_SEARCH).useValue(hotels)
      .overrideProvider(ITINERARY_HOTEL_BOOKINGS).useValue(hotelBookings)
      .overrideProvider(ITINERARY_FLIGHT_BOOKINGS).useValue(flightBookings)
      .compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    connection = moduleRef.get(getConnectionToken());
    users = moduleRef.get(getModelToken(User.name));
    accountStatuses = moduleRef.get(ITINERARY_ACCOUNT_STATUSES);
    itinerariesService = moduleRef.get(ItinerariesService);
    await Promise.all([users.init(), moduleRef.get<Model<Itinerary>>(getModelToken(Itinerary.name)).init()]);
    await moduleRef.get(CurrenciesService).seedSupported();
    await moduleRef.get(ReferenceDataService).seedSupported();
    await moduleRef.get(AirportsService).seedPredefined();
  }, { timeout: 30 * 60_000 });

  beforeEach(async () => {
    for (const name of ['users', 'authsessions', 'itineraries', 'activityimages', 'exchangerates']) {
      await connection.collection(name).deleteMany({});
    }
    Object.assign(fx, { calls: 0, fail: false, omit: [] });
    flights.criteria = [];
    hotels.criteria = [];
    hotelBookings.rows.clear();
    hotelBookings.fail = false;
    flightBookings.rows.clear();
    flightBookings.fail = false;
    alice = await login('alice@example.com');
    bob = await login('bob@example.com');
  });

  after(async () => {
    await app?.close();
    await mongo?.stop();
  });

  describe('ITN-01/ITN-03 itinerary CRUD and ownership (ACC-11)', () => {
    it('creates an itinerary for the owner with defaults', async () => {
      const response = await http().post('/api/itineraries').set('Cookie', alice)
        .send({ title: '  Egypt trip ', countries: ['eg'], startDate: '2026-12-20' }).expect(201);
      assert.equal(response.body.title, 'Egypt trip');
      assert.deepEqual(response.body.countries, ['EG']);
      assert.equal(response.body.visibility, 'PRIVATE');
      assert.equal(response.body.currency, 'USD');
      assert.equal(response.body.dayCount, 0);
      assert.deepEqual(response.body.days, []);
    });

    it("defaults the currency to the user's preferredCurrency", async () => {
      const carol = await login('carol@example.com', { preferredCurrency: 'EGP' });
      const response = await http().post('/api/itineraries').set('Cookie', carol)
        .send({ title: 'Trip', countries: ['EG'], startDate: '2026-12-20' }).expect(201);
      assert.equal(response.body.currency, 'EGP');
    });

    it('rejects guests, non-travellers, bad dates and unsupported currencies', async () => {
      await http().post('/api/itineraries').send({ title: 'x', countries: ['EG'], startDate: '2026-12-20' }).expect(401);
      for (const [email, role] of [
        ['admin@example.com', UserRole.ADMIN],
        ['airline-moderator@example.com', UserRole.AIRLINE_MODERATOR],
        ['hotel-moderator@example.com', UserRole.HOTEL_MODERATOR],
      ] as const) {
        const cookie = await login(email, { role });
        await http().post('/api/itineraries').set('Cookie', cookie)
          .send({ title: 'x', countries: ['EG'], startDate: '2026-12-20' }).expect(403);
      }
      const badDate = await http().post('/api/itineraries').set('Cookie', alice).send({ title: 'x', countries: ['EG'], startDate: '2026-02-30' }).expect(400);
      assert.ok(badDate.body.errors.startDate);
      const badCurrency = await http().post('/api/itineraries').set('Cookie', alice)
        .send({ title: 'x', countries: ['EG'], startDate: '2026-12-20', currency: 'CHF' }).expect(400);
      assert.match(badCurrency.body.errors.currency[0], /Unsupported currency CHF/);
      await http().post('/api/itineraries').set('Cookie', alice)
        .send({ title: 'x', countries: ['EG'], startDate: '2026-12-20', userId: 'someone' }).expect(400);
    });

    it('keeps private itineraries owner-only, including for admins', async () => {
      const id = await createItinerary();
      const admin = await login('admin@example.com', { role: UserRole.ADMIN });
      await http().get(`/api/itineraries/${id}`).set('Cookie', alice).expect(200);
      await http().get(`/api/itineraries/${id}`).set('Cookie', bob).expect(404);
      await http().get(`/api/itineraries/${id}`).set('Cookie', admin).expect(404);
      await http().get(`/api/itineraries/${id}`).expect(404);
      await http().get(`/api/itineraries/public/${id}`).expect(404);
      await http().patch(`/api/itineraries/${id}`).set('Cookie', bob).send({ title: 'mine now' }).expect(404);
      await http().delete(`/api/itineraries/${id}`).set('Cookie', bob).expect(404);
      await http().post(`/api/itineraries/${id}/days`).set('Cookie', bob).send({ city: 'Cairo' }).expect(404);
      await http().get(`/api/itineraries/${id}/budget-summary`).set('Cookie', admin).expect(404);
      await http().get('/api/itineraries/not-an-id').set('Cookie', alice).expect(404);
    });

    it('lists only your own itineraries and paginates', async () => {
      for (let i = 0; i < 12; i += 1) await createItinerary(alice, { title: `Trip ${i}` });
      await createItinerary(bob);
      const first = await http().get('/api/itineraries').set('Cookie', alice).expect(200);
      assert.equal(first.body.total, 12);
      assert.equal(first.body.items.length, 10);
      assert.equal(first.body.totalPages, 2);
      const second = await http().get('/api/itineraries?page=2').set('Cookie', alice).expect(200);
      assert.equal(second.body.items.length, 2);
      await http().get('/api/itineraries').expect(401);
    });

    it('updates and deletes an itinerary', async () => {
      const id = await createItinerary();
      const updated = await http().patch(`/api/itineraries/${id}`).set('Cookie', alice)
        .send({ title: 'New', currency: 'eur', visibility: 'PUBLIC' }).expect(200);
      assert.equal(updated.body.title, 'New');
      assert.equal(updated.body.currency, 'EUR');
      assert.equal(updated.body.visibility, 'PUBLIC');
      assert.ok(updated.body.publishedAt);
      await http().delete(`/api/itineraries/${id}`).set('Cookie', alice).expect(204);
      await http().get(`/api/itineraries/${id}`).set('Cookie', alice).expect(404);
    });
  });

  describe('ITN-05/ITN-07/ITN-08 days, numbering, dates and city grouping', () => {
    it('derives day numbers, dates and city stops, and keeps them consistent after every change', async () => {
      const id = await createItinerary();
      await addDay(id, 'Cairo');
      await addDay(id, 'Cairo');
      let body = await addDay(id, 'London');
      assert.deepEqual(body.days.map((d: { dayNumber: number; date: string }) => [d.dayNumber, d.date]),
        [[1, '2026-12-20'], [2, '2026-12-21'], [3, '2026-12-22']]);
      assert.deepEqual(body.cityGroups.map((g: { city: string; dayCount: number }) => [g.city, g.dayCount]), [['Cairo', 2], ['London', 1]]);
      assert.equal(body.endDate, '2026-12-22');

      // Insert at the start: everything shifts forward.
      body = await addDay(id, 'Dubai', { position: 1 });
      assert.deepEqual(body.days.map((d: { city: string; date: string }) => `${d.city}@${d.date}`),
        ['Dubai@2026-12-20', 'Cairo@2026-12-21', 'Cairo@2026-12-22', 'London@2026-12-23']);

      // Reorder: London first, one Cairo between Dubai... grouping follows order.
      const [alex, cairo1, cairo2, london] = body.days.map((d: { dayId: string }) => d.dayId);
      body = (await http().patch(`/api/itineraries/${id}/days/reorder`).set('Cookie', alice)
        .send({ dayIds: [cairo1, london, cairo2, alex] }).expect(200)).body;
      assert.deepEqual(body.days.map((d: { city: string; dayNumber: number }) => `${d.dayNumber}:${d.city}`),
        ['1:Cairo', '2:London', '3:Cairo', '4:Dubai']);
      assert.deepEqual(body.cityGroups.map((g: { city: string }) => g.city), ['Cairo', 'London', 'Cairo', 'Dubai']);
      assert.equal(body.days[0].dayId, cairo1, 'ids are stable across reorder');

      // Delete day 2: later days move back one date.
      body = (await http().delete(`/api/itineraries/${id}/days/${london}`).set('Cookie', alice).expect(200)).body;
      assert.deepEqual(body.days.map((d: { city: string; date: string }) => `${d.city}@${d.date}`),
        ['Cairo@2026-12-20', 'Cairo@2026-12-21', 'Dubai@2026-12-22']);
      assert.deepEqual(body.cityGroups.map((g: { city: string; dayCount: number }) => [g.city, g.dayCount]), [['Cairo', 2], ['Dubai', 1]]);

      // Changing the start date moves every day.
      body = (await http().patch(`/api/itineraries/${id}`).set('Cookie', alice).send({ startDate: '2027-01-01' }).expect(200)).body;
      assert.deepEqual(body.days.map((d: { date: string }) => d.date), ['2027-01-01', '2027-01-02', '2027-01-03']);
    });

    it('rejects a reorder that is not exactly the set of days, and invalid positions', async () => {
      const id = await createItinerary();
      const a = (await addDay(id, 'Cairo')).days[0].dayId;
      const b = (await addDay(id, 'London')).days[1].dayId;
      await http().patch(`/api/itineraries/${id}/days/reorder`).set('Cookie', alice).send({ dayIds: [a] }).expect(400);
      await http().patch(`/api/itineraries/${id}/days/reorder`).set('Cookie', alice).send({ dayIds: [a, a] }).expect(400);
      await http().patch(`/api/itineraries/${id}/days/reorder`).set('Cookie', alice)
        .send({ dayIds: [a, '665f1f77bcf86cd799439011'] }).expect(400);
      await http().patch(`/api/itineraries/${id}/days/reorder`).set('Cookie', alice).send({ dayIds: [b, a] }).expect(200);
      await http().post(`/api/itineraries/${id}/days`).set('Cookie', alice).send({ city: 'Paris', position: 5 }).expect(400);
      await http().post(`/api/itineraries/${id}/days`).set('Cookie', alice).send({ city: 'Paris', position: 0 }).expect(400);
    });

    it('updates a day and returns 404 for unknown days', async () => {
      const id = await createItinerary();
      const dayId = (await addDay(id, 'Cairo', { notes: 'arrive' })).days[0].dayId;
      const body = (await http().patch(`/api/itineraries/${id}/days/${dayId}`).set('Cookie', alice).send({ city: 'Dubai', notes: '' }).expect(200)).body;
      assert.equal(body.days[0].city, 'Dubai');
      assert.equal(body.days[0].notes, undefined);
      await http().patch(`/api/itineraries/${id}/days/665f1f77bcf86cd799439011`).set('Cookie', alice).send({ city: 'x' }).expect(404);
    });
  });

  describe('ITN-10/ITN-12 activities and images', () => {
    it('adds, updates and deletes activities with time validation', async () => {
      const id = await createItinerary();
      const dayId = (await addDay(id, 'Cairo')).days[0].dayId;
      let body = (await http().post(`/api/itineraries/${id}/days/${dayId}/activities`).set('Cookie', alice)
        .send({ title: 'Museum', startTime: '09:00', endTime: '12:00' }).expect(201)).body;
      const activityId = body.days[0].activities[0].activityId;
      await http().post(`/api/itineraries/${id}/days/${dayId}/activities`).set('Cookie', alice)
        .send({ title: 'Bad', startTime: '15:00', endTime: '14:00' }).expect(400);
      await http().patch(`/api/activities/${activityId}`).set('Cookie', alice).send({ endTime: '08:00' }).expect(400);
      body = (await http().patch(`/api/activities/${activityId}`).set('Cookie', alice).send({ title: 'Egyptian Museum', location: 'Tahrir' }).expect(200)).body;
      assert.equal(body.days[0].activities[0].title, 'Egyptian Museum');
      await http().patch(`/api/activities/${activityId}`).set('Cookie', bob).send({ title: 'x' }).expect(404);
      body = (await http().delete(`/api/activities/${activityId}`).set('Cookie', alice).expect(200)).body;
      assert.equal(body.days[0].activities.length, 0);
    });

    it('validates uploads by content and enforces image visibility', async () => {
      const id = await createItinerary();
      const dayId = (await addDay(id, 'Cairo')).days[0].dayId;
      const activityId = (await http().post(`/api/itineraries/${id}/days/${dayId}/activities`).set('Cookie', alice)
        .send({ title: 'Museum' }).expect(201)).body.days[0].activities[0].activityId;

      await http().post(`/api/activities/${activityId}/images`).set('Cookie', alice)
        .attach('image', Buffer.from('not an image'), { filename: 'fake.png', contentType: 'image/png' }).expect(400);
      await http().post(`/api/activities/${activityId}/images`).set('Cookie', alice).expect(400);
      await http().post(`/api/activities/${activityId}/images`).set('Cookie', bob)
        .attach('image', PNG, { filename: 'a.png', contentType: 'image/png' }).expect(404);
      await http().post(`/api/activities/${activityId}/images`).set('Cookie', alice)
        .attach('image', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), { filename: 'big.png', contentType: 'image/png' }).expect(413);

      const body = (await http().post(`/api/activities/${activityId}/images`).set('Cookie', alice)
        .attach('image', PNG, { filename: 'a.png', contentType: 'application/octet-stream' }).expect(201)).body;
      const image = body.days[0].activities[0].images[0];
      assert.equal(image.contentType, 'image/png');

      const download = await http().get(image.url).set('Cookie', alice).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
      assert.equal(download.headers['content-type'], 'image/png');
      assert.ok((download.body as Buffer).equals(PNG));
      await http().get(image.url).expect(404); // private itinerary
      await http().patch(`/api/itineraries/${id}`).set('Cookie', alice).send({ visibility: 'PUBLIC' }).expect(200);
      await http().get(image.url).expect(200);

      await http().delete(`/api/activities/${activityId}/images/${image.imageId}`).set('Cookie', alice).expect(200);
      await http().get(image.url).expect(404);
      assert.equal(await connection.collection('activityimages').countDocuments(), 0);
    });

    it('removes images when their day or itinerary is deleted', async () => {
      const id = await createItinerary();
      const dayId = (await addDay(id, 'Cairo')).days[0].dayId;
      const activityId = (await http().post(`/api/itineraries/${id}/days/${dayId}/activities`).set('Cookie', alice)
        .send({ title: 'Museum' }).expect(201)).body.days[0].activities[0].activityId;
      await http().post(`/api/activities/${activityId}/images`).set('Cookie', alice).attach('image', PNG, 'a.png').expect(201);
      await http().delete(`/api/itineraries/${id}/days/${dayId}`).set('Cookie', alice).expect(200);
      assert.equal(await connection.collection('activityimages').countDocuments(), 0);
    });
  });

  describe('ITN-14/ITN-16/ITN-18 budgets, transport and currency conversion', () => {
    async function budgetedItinerary() {
      const id = await createItinerary(alice, { currency: 'USD' });
      const cairo = (await addDay(id, 'Cairo')).days[0].dayId;
      const london = (await addDay(id, 'London')).days[1].dayId;
      await http().post(`/api/itineraries/${id}/days/${cairo}/budgets`).set('Cookie', alice).send({ category: 'FOOD', amount: 500, currency: 'egp' }).expect(201);
      await http().post(`/api/itineraries/${id}/days/${cairo}/budgets`).set('Cookie', alice).send({ category: 'ACCOMMODATION', amount: 80, currency: 'USD' }).expect(201);
      await http().post(`/api/itineraries/${id}/days/${london}/budgets`).set('Cookie', alice).send({ category: 'ACTIVITIES', amount: 45, currency: 'EUR' }).expect(201);
      await http().post(`/api/itineraries/${id}/days/${london}/budgets`).set('Cookie', alice).send({ category: 'LOCAL_TRANSPORT', amount: 100, currency: 'EGP' }).expect(201);
      const body = (await http().post(`/api/itineraries/${id}/transport-costs`).set('Cookie', alice)
        .send({ fromCity: 'Cairo', toCity: 'London', mode: 'TRAIN', amount: 1000, currency: 'EGP', dayId: london }).expect(201)).body;
      return { id, cairo, london, body };
    }

    it('validates budget entries and transport costs', async () => {
      const id = await createItinerary();
      const dayId = (await addDay(id, 'Cairo')).days[0].dayId;
      const post = (body: object) => http().post(`/api/itineraries/${id}/days/${dayId}/budgets`).set('Cookie', alice).send(body);
      await post({ category: 'SHOPPING', amount: 1, currency: 'USD' }).expect(400);
      await post({ category: 'FOOD', amount: -1, currency: 'USD' }).expect(400);
      await post({ category: 'FOOD', amount: 1.234, currency: 'USD' }).expect(400);
      await post({ category: 'FOOD', amount: '10', currency: 'USD' }).expect(400);
      const unsupported = await post({ category: 'FOOD', amount: 10, currency: 'CHF' }).expect(400);
      assert.match(unsupported.body.errors.currency[0], /Supported: AED, EGP, EUR, GBP, JPY, SAR, USD/);
      await http().post(`/api/itineraries/${id}/transport-costs`).set('Cookie', alice)
        .send({ fromCity: 'A', toCity: 'B', mode: 'TRAIN', amount: 1, currency: 'USD', dayId: '665f1f77bcf86cd799439011' }).expect(400);
    });

    it('summarises per category, day, city and transport in the requested currency', async () => {
      const { id, body } = await budgetedItinerary();
      assert.equal(body.transportCosts[0].dayNumber, 2);
      const summary = (await http().get(`/api/itineraries/${id}/budget-summary`).set('Cookie', alice).expect(200)).body;
      assert.equal(summary.currency, 'USD');
      // 500 EGP = 10 USD; 45 EUR = 50 USD; 100 EGP = 2 USD; 1000 EGP = 20 USD.
      assert.deepEqual(summary.totals, {
        categories: { FOOD: 10, ACCOMMODATION: 80, ACTIVITIES: 50, LOCAL_TRANSPORT: 2 },
        daily: 142, transport: 20, grandTotal: 162,
      });
      assert.deepEqual(summary.byDay.map((d: { total: number }) => d.total), [90, 72]);
      assert.deepEqual(summary.byCity.map((c: { city: string; total: number }) => [c.city, c.total]), [['Cairo', 90], ['London', 72]]);
      assert.equal(summary.transportCosts[0].convertedAmount, 20);
      assert.deepEqual(summary.originalTotals, [
        { currency: 'EGP', amount: 1600 }, { currency: 'EUR', amount: 45 }, { currency: 'USD', amount: 80 },
      ]);
      assert.equal(summary.ratesStale, false);

      const inEgp = (await http().get(`/api/itineraries/${id}/budget-summary?currency=egp`).set('Cookie', alice).expect(200)).body;
      assert.equal(inEgp.currency, 'EGP');
      assert.equal(inEgp.totals.grandTotal, 8100);
      await http().get(`/api/itineraries/${id}/budget-summary?currency=XYZ`).set('Cookie', alice).expect(400);
      await http().get(`/api/itineraries/${id}/budget-summary?currency=dollars`).set('Cookie', alice).expect(400);
    });

    it('caches rates, falls back to stale rates, and reports provider failures', async () => {
      const { id } = await budgetedItinerary();
      await http().get(`/api/itineraries/${id}/budget-summary`).set('Cookie', alice).expect(200);
      await http().get(`/api/itineraries/${id}/budget-summary`).set('Cookie', alice).expect(200);
      assert.equal(fx.calls, 1, 'second request uses the cache');

      await connection.collection('exchangerates').updateMany({}, { $set: { fetchedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } });
      fx.fail = true;
      const stale = (await http().get(`/api/itineraries/${id}/budget-summary`).set('Cookie', alice).expect(200)).body;
      assert.equal(stale.ratesStale, true);
      assert.equal(stale.totals.grandTotal, 162);

      await connection.collection('exchangerates').deleteMany({});
      const down = await http().get(`/api/itineraries/${id}/budget-summary`).set('Cookie', alice).expect(503);
      assert.match(down.body.message, /temporarily unavailable/);

      fx.fail = false;
      fx.omit = ['EUR'];
      const missing = await http().get(`/api/itineraries/${id}/budget-summary`).set('Cookie', alice).expect(422);
      assert.match(missing.body.message, /EUR/);
    });

    it('needs no rates when every amount is already in the display currency', async () => {
      const id = await createItinerary(alice, { currency: 'EGP' });
      const dayId = (await addDay(id, 'Cairo')).days[0].dayId;
      await http().post(`/api/itineraries/${id}/days/${dayId}/budgets`).set('Cookie', alice).send({ category: 'FOOD', amount: 10.1, currency: 'EGP' }).expect(201);
      fx.fail = true;
      const summary = (await http().get(`/api/itineraries/${id}/budget-summary`).set('Cookie', alice).expect(200)).body;
      assert.equal(summary.totals.grandTotal, 10.1);
      assert.equal(summary.rateDate, null);
    });

    it('updates and deletes budget entries and transport costs, owner only', async () => {
      const { id, body } = await budgetedItinerary();
      const budgetId = body.days[0].budgets[0].budgetId;
      const costId = body.transportCosts[0].transportCostId;
      await http().patch(`/api/budgets/${budgetId}`).set('Cookie', bob).send({ amount: 1 }).expect(404);
      let updated = (await http().patch(`/api/budgets/${budgetId}`).set('Cookie', alice).send({ amount: 750, currency: 'usd' }).expect(200)).body;
      assert.deepEqual([updated.days[0].budgets[0].amount, updated.days[0].budgets[0].currency], [750, 'USD']);
      await http().patch(`/api/budgets/${budgetId}`).set('Cookie', alice).send({ currency: 'CHF' }).expect(400);
      updated = (await http().patch(`/api/transport-costs/${costId}`).set('Cookie', alice).send({ mode: 'BUS', amount: 300 }).expect(200)).body;
      assert.equal(updated.transportCosts[0].mode, 'BUS');
      await http().delete(`/api/transport-costs/${costId}`).set('Cookie', bob).expect(404);
      await http().delete(`/api/transport-costs/${costId}`).set('Cookie', alice).expect(200);
      updated = (await http().delete(`/api/budgets/${budgetId}`).set('Cookie', alice).expect(200)).body;
      assert.equal(updated.days[0].budgets.length, 1);
      assert.equal(updated.transportCosts.length, 0);
      await http().get(`/api/itineraries/${id}`).set('Cookie', alice).expect(200);
    });

    it('removes a transport cost when its required day is deleted', async () => {
      const { id, london } = await budgetedItinerary();
      const body = (await http().delete(`/api/itineraries/${id}/days/${london}`).set('Cookie', alice).expect(200)).body;
      assert.equal(body.transportCosts.length, 0);
      assert.deepEqual(body.transportCosts, []);
    });
  });

  describe('ITN-20/ITN-21 public search, viewing and cloning (ACC-12)', () => {
    async function publicItinerary(cookie: string, title: string, cities: string[], country?: string) {
      const codes: Record<string, string> = { Cairo: 'EG', London: 'GB', Paris: 'FR', Dubai: 'AE' };
      const countries = [...new Set(cities.map((city) => country ?? codes[city]))];
      const id = await createItinerary(cookie, { title, countries, visibility: 'PUBLIC' });
      for (const city of cities) await addDay(id, city, { countryCode: country ?? codes[city] }, cookie);
      return id;
    }

    it('lets guests search and view public itineraries only', async () => {
      await publicItinerary(alice, 'Nile cruise', ['London', 'Paris']);
      await publicItinerary(bob, 'Paris weekend', ['Paris'], 'FR');
      await createItinerary(alice, { title: 'Secret Nile plan' });

      let page = (await http().get('/api/itineraries/public/search').expect(200)).body;
      assert.equal(page.total, 2);
      page = (await http().get('/api/itineraries/public/search?q=nile').expect(200)).body;
      assert.deepEqual(page.items.map((i: { title: string }) => i.title), ['Nile cruise']);
      assert.equal(page.items[0].author.name, 'alice');
      assert.deepEqual(page.items[0].cities, ['London', 'Paris']);
      page = (await http().get('/api/itineraries/public/search?country=fr').expect(200)).body;
      assert.deepEqual(page.items.map((i: { title: string }) => i.title), ['Paris weekend', 'Nile cruise']);
      page = (await http().get('/api/itineraries/public/search?city=paris').expect(200)).body;
      assert.equal(page.total, 2);
      page = (await http().get('/api/itineraries/public/search?minDays=2').expect(200)).body;
      assert.equal(page.total, 1);
      page = (await http().get('/api/itineraries/public/search?sort=SHORTEST').expect(200)).body;
      assert.deepEqual(page.items.map((i: { title: string }) => i.title), ['Paris weekend', 'Nile cruise']);
      page = (await http().get('/api/itineraries/public/search?q=.*').expect(200)).body;
      assert.equal(page.total, 0, 'search text is not a regex');
      await http().get('/api/itineraries/public/search?minDays=3&maxDays=1').expect(400);
      await http().get('/api/itineraries/public/search?sort=RANDOM').expect(400);
    });

    it('hides deactivated and missing authors before pagination, but not suspended ones', async () => {
      for (let i = 0; i < 12; i += 1) await publicItinerary(alice, `Alice ${i}`, ['Cairo']);
      const bobsId = await publicItinerary(bob, 'Bob trip', ['Cairo']);
      const carol = await login('carol@example.com');
      const carolsId = await publicItinerary(carol, 'Carol trip', ['Cairo']);

      await setStatus('alice@example.com', AccountStatus.DEACTIVATED);
      await setStatus('bob@example.com', AccountStatus.SUSPENDED);
      await users.deleteOne({ email: 'carol@example.com' }).exec();

      const page = (await http().get('/api/itineraries/public/search').expect(200)).body;
      assert.equal(page.total, 1);
      assert.equal(page.totalPages, 1);
      assert.deepEqual(page.items.map((i: { itineraryId: string }) => i.itineraryId), [bobsId]);
      await http().get(`/api/itineraries/public/${carolsId}`).expect(404);

      const alicesId = (await connection.collection('itineraries').findOne({ title: 'Alice 0' }))!._id.toString();
      const dave = await login('dave@example.com');
      await http().get(`/api/itineraries/public/${alicesId}`).expect(404);
      await http().get(`/api/itineraries/${alicesId}`).set('Cookie', dave).expect(404);
      await http().get(`/api/itineraries/${alicesId}/budget-summary`).set('Cookie', dave).expect(404);
      await http().post(`/api/itineraries/${alicesId}/clone`).set('Cookie', dave).expect(404);
      const stored = await connection.collection('itineraries').findOne({ title: 'Alice 0' });
      assert.equal(stored!.visibility, 'PUBLIC', 'the setting is preserved for reactivation');

      await setStatus('alice@example.com', AccountStatus.ACTIVE);
      await http().get(`/api/itineraries/public/${alicesId}`).expect(200);
    });

    it('clones into an independent private copy with attribution', async () => {
      const sourceId = await publicItinerary(alice, 'Nile cruise', ['London', 'Paris']);
      const source = (await http().get(`/api/itineraries/${sourceId}`).set('Cookie', alice).expect(200)).body;
      const london = source.days[0].dayId;
      const activityId = (await http().post(`/api/itineraries/${sourceId}/days/${london}/activities`).set('Cookie', alice)
        .send({ title: 'Karnak' }).expect(201)).body.days[0].activities[0].activityId;
      await http().post(`/api/activities/${activityId}/images`).set('Cookie', alice).attach('image', PNG, 'k.png').expect(201);
      await http().post(`/api/itineraries/${sourceId}/days/${london}/budgets`).set('Cookie', alice).send({ category: 'FOOD', amount: 20, currency: 'USD' }).expect(201);
      await http().post(`/api/itineraries/${sourceId}/transport-costs`).set('Cookie', alice)
        .send({ fromCity: 'London', toCity: 'Paris', mode: 'TRAIN', amount: 15, currency: 'USD', dayId: source.days[1].dayId }).expect(201);

      await http().post(`/api/itineraries/${sourceId}/clone`).expect(401);
      for (const [email, role] of [
        ['admin@example.com', UserRole.ADMIN],
        ['airline-moderator@example.com', UserRole.AIRLINE_MODERATOR],
        ['hotel-moderator@example.com', UserRole.HOTEL_MODERATOR],
      ] as const) {
        const cookie = await login(email, { role });
        await http().post(`/api/itineraries/${sourceId}/clone`).set('Cookie', cookie).expect(403);
      }
      const clone = (await http().post(`/api/itineraries/${sourceId}/clone`).set('Cookie', bob).expect(201)).body;
      assert.notEqual(clone.itineraryId, sourceId);
      assert.equal(clone.visibility, 'PRIVATE');
      assert.equal(clone.clonedFrom.itineraryId, sourceId);
      assert.equal(clone.clonedFrom.authorName, 'alice');
      assert.equal(clone.clonedFrom.title, 'Nile cruise');
      assert.equal(clone.days.length, 2);
      assert.notEqual(clone.days[0].dayId, london);
      assert.equal(clone.days[0].activities[0].title, 'Karnak');
      assert.equal(clone.transportCosts[0].dayId, clone.days[1].dayId, 'transport link is remapped');
      const cloneImage = clone.days[0].activities[0].images[0];
      await http().get(cloneImage.url).set('Cookie', bob).expect(200);

      // Independent: editing or deleting the original does not touch the clone.
      await http().patch(`/api/itineraries/${sourceId}/days/${london}`).set('Cookie', alice).send({ city: 'Paris' }).expect(200);
      await http().delete(`/api/itineraries/${sourceId}`).set('Cookie', alice).expect(204);
      const after = (await http().get(`/api/itineraries/${clone.itineraryId}`).set('Cookie', bob).expect(200)).body;
      assert.equal(after.days[0].city, 'London');
      await http().get(cloneImage.url).set('Cookie', bob).expect(200);
      await http().get(`/api/itineraries/${clone.itineraryId}`).set('Cookie', alice).expect(404);

      // Attribution reads "Deleted user" once the original author is deactivated.
      await setStatus('alice@example.com', AccountStatus.DEACTIVATED);
      const attributed = (await http().get(`/api/itineraries/${clone.itineraryId}`).set('Cookie', bob).expect(200)).body;
      assert.equal(attributed.clonedFrom.authorName, 'Deleted user');
    });

    it('fails closed when the account-status lookup fails', async () => {
      const id = await publicItinerary(alice, 'Nile cruise', ['London']);
      const original = accountStatuses.getAccountStatuses;
      accountStatuses.getAccountStatuses = async () => { throw new Error('users collection unavailable'); };
      try {
        await http().get('/api/itineraries/public/search').expect(500);
        await http().get(`/api/itineraries/public/${id}`).expect(500);
        await http().get(`/api/itineraries/${id}`).set('Cookie', bob).expect(500);
        await http().post(`/api/itineraries/${id}/clone`).set('Cookie', bob).expect(500);
        assert.equal(await connection.collection('itineraries').countDocuments(), 1, 'nothing was cloned');
        // The owner's own access does not depend on the author lookup.
        await http().get(`/api/itineraries/${id}`).set('Cookie', alice).expect(200);
      } finally {
        accountStatuses.getAccountStatuses = original;
      }
    });

    it('does not clone private itineraries', async () => {
      const id = await createItinerary();
      await http().post(`/api/itineraries/${id}/clone`).set('Cookie', bob).expect(404);
    });
  });

  describe('read-only views for the blog (BLG-12, BLG-13)', () => {
    const userIdOf = async (email: string) => (await users.findOne({ email }).lean().exec())!._id.toString();

    it("lists an author's public itineraries with the same visibility rules as public search", async () => {
      const aliceId = await userIdOf('alice@example.com');
      for (let i = 0; i < 11; i += 1) await createItinerary(alice, { title: `Public ${i}`, visibility: 'PUBLIC' });
      await createItinerary(alice, { title: 'Secret plan' });
      await createItinerary(bob, { title: 'Bob trip', visibility: 'PUBLIC' });

      const first = await itinerariesService.listPublicByAuthor(aliceId);
      assert.equal(first.total, 11);
      assert.equal(first.totalPages, 2);
      assert.equal(first.items.length, 10);
      assert.equal(first.items[0].title, 'Public 10', 'newest published first');
      assert.equal(first.items[0].author?.name, 'alice');
      assert.ok(first.items.every((item) => item.visibility === 'PUBLIC' && item.userId === aliceId));
      assert.ok(first.items.every((item) => !('days' in item) && !('linkedBookings' in item)), 'summary fields only');
      assert.equal((await itinerariesService.listPublicByAuthor(aliceId, 2)).items.length, 1);

      await setStatus('alice@example.com', AccountStatus.SUSPENDED);
      assert.equal((await itinerariesService.listPublicByAuthor(aliceId)).total, 11, 'suspended authors stay visible');
      await setStatus('alice@example.com', AccountStatus.DEACTIVATED);
      assert.deepEqual(await itinerariesService.listPublicByAuthor(aliceId), { items: [], page: 1, pageSize: 10, total: 0, totalPages: 0 });
      assert.equal((await itinerariesService.listPublicByAuthor(new Types.ObjectId().toString())).total, 0, 'missing author');
      assert.equal((await itinerariesService.listPublicByAuthor('not-an-id')).total, 0);
    });

    it("shows a clone's deactivated original author as Deleted user", async () => {
      const sourceId = await createItinerary(bob, { title: 'Nile cruise', visibility: 'PUBLIC' });
      const clone = (await http().post(`/api/itineraries/${sourceId}/clone`).set('Cookie', alice).expect(201)).body;
      await http().patch(`/api/itineraries/${clone.itineraryId}`).set('Cookie', alice).send({ visibility: 'PUBLIC' }).expect(200);
      await setStatus('bob@example.com', AccountStatus.DEACTIVATED);
      const page = await itinerariesService.listPublicByAuthor(await userIdOf('alice@example.com'));
      assert.equal(page.items[0].clonedFrom?.authorName, 'Deleted user');
    });

    it('returns one public summary only while it is public and its author is visible', async () => {
      const aliceId = await userIdOf('alice@example.com');
      const bobId = await userIdOf('bob@example.com');
      const id = await createItinerary(alice, { title: 'Nile cruise', visibility: 'PUBLIC' });
      const privateId = await createItinerary(alice, { title: 'Secret plan' });

      const summary = await itinerariesService.getPublicSummary(id);
      assert.equal(summary?.title, 'Nile cruise');
      assert.equal(summary?.author?.name, 'alice');
      assert.equal('days' in summary!, false);
      assert.equal((await itinerariesService.getPublicSummary(id, aliceId))?.itineraryId, id);
      assert.equal(await itinerariesService.getPublicSummary(id, bobId), null, "another author's itinerary");
      assert.equal(await itinerariesService.getPublicSummary(privateId), null);
      assert.equal(await itinerariesService.getPublicSummary(privateId, aliceId), null, 'private even for its owner');
      assert.equal(await itinerariesService.getPublicSummary('not-an-id'), null);
      assert.equal(await itinerariesService.getPublicSummary(id, 'not-an-id'), null);
      assert.equal(await itinerariesService.getPublicSummary(new Types.ObjectId().toString()), null);

      await http().patch(`/api/itineraries/${id}`).set('Cookie', alice).send({ visibility: 'PRIVATE' }).expect(200);
      assert.equal(await itinerariesService.getPublicSummary(id), null, 'made private');
      await http().patch(`/api/itineraries/${id}`).set('Cookie', alice).send({ visibility: 'PUBLIC' }).expect(200);
      await setStatus('alice@example.com', AccountStatus.DEACTIVATED);
      assert.equal(await itinerariesService.getPublicSummary(id), null, 'deactivated author');
    });

    it('fails closed when the account-status lookup fails', async () => {
      const id = await createItinerary(alice, { visibility: 'PUBLIC' });
      const original = accountStatuses.getAccountStatuses;
      accountStatuses.getAccountStatuses = async () => { throw new Error('users unavailable'); };
      try {
        await assert.rejects(itinerariesService.listPublicByAuthor(await userIdOf('alice@example.com')));
        await assert.rejects(itinerariesService.getPublicSummary(id));
      } finally {
        accountStatuses.getAccountStatuses = original;
      }
    });
  });

  describe('ITN-27 (bonus) linked bookings', () => {
    const userIdOf = async (email: string) => (await users.findOne({ email }).lean().exec())!._id.toString();

    /** Days: Cairo 2026-12-20, Cairo 2026-12-21, London 2026-12-22. */
    async function tripWithDays(cookie = alice) {
      const id = await createItinerary(cookie, { currency: 'USD' });
      await addDay(id, 'Cairo', {}, cookie);
      await addDay(id, 'Cairo', {}, cookie);
      const body = await addDay(id, 'London', {}, cookie);
      return { id, dayIds: body.days.map((day: { dayId: string }) => day.dayId) as string[] };
    }

    const link = (id: string, body: Record<string, unknown>, cookie = alice) =>
      http().post(`/api/itineraries/${id}/bookings`).set('Cookie', cookie).send(body);

    it('links a confirmed hotel booking for the owner and feeds the budget', async () => {
      const { id, dayIds } = await tripWithDays();
      const bookingId = hotelBookings.add(await userIdOf('alice@example.com'));

      const linked = (await link(id, { type: 'HOTEL', bookingId, dayId: dayIds[0] }).expect(201)).body;
      assert.equal(linked.linkedBookings.length, 1);
      assert.deepEqual(
        (({ type, bookingId: b, dayId, status, countsInBudget, label, bookingReference, amount, currency, startDate, endDate, matchesDay }) =>
          ({ type, b, dayId, status, countsInBudget, label, bookingReference, amount, currency, startDate, endDate, matchesDay }))(linked.linkedBookings[0]),
        { type: 'HOTEL', b: bookingId, dayId: dayIds[0], status: 'CONFIRMED', countsInBudget: true, label: 'Nile Hotel',
          bookingReference: 'HB-TEST1', amount: 250.5, currency: 'USD', startDate: '2026-12-20', endDate: '2026-12-22', matchesDay: true },
      );
      await link(id, { type: 'HOTEL', bookingId, dayId: dayIds[1] }).expect(409);

      let summary = (await http().get(`/api/itineraries/${id}/budget-summary`).set('Cookie', alice).expect(200)).body;
      assert.equal(summary.totals.categories.ACCOMMODATION, 250.5);
      assert.equal(summary.totals.grandTotal, 250.5);
      assert.equal(summary.byDay[0].categories.ACCOMMODATION, 250.5);
      assert.equal(summary.byDay[1].categories.ACCOMMODATION, 0);
      assert.equal(summary.linkedBookings[0].convertedAmount, 250.5);
      assert.deepEqual(summary.originalTotals, [{ currency: 'USD', amount: 250.5 }]);
      // 1 USD = 50 EGP.
      summary = (await http().get(`/api/itineraries/${id}/budget-summary?currency=EGP`).set('Cookie', alice).expect(200)).body;
      assert.equal(summary.totals.categories.ACCOMMODATION, 12525);

      // A later cancellation stays visible but no longer counts.
      hotelBookings.rows.get(bookingId)!.booking.status = BookingStatus.CANCELLED;
      const owner = (await http().get(`/api/itineraries/${id}`).set('Cookie', alice).expect(200)).body;
      assert.equal(owner.linkedBookings[0].status, 'CANCELLED');
      assert.equal(owner.linkedBookings[0].countsInBudget, false);
      summary = (await http().get(`/api/itineraries/${id}/budget-summary`).set('Cookie', alice).expect(200)).body;
      assert.equal(summary.totals.grandTotal, 0);
      assert.equal(summary.linkedBookings[0].convertedAmount, 0);

      // A booking that no longer exists shows as unavailable.
      hotelBookings.rows.delete(bookingId);
      const gone = (await http().get(`/api/itineraries/${id}`).set('Cookie', alice).expect(200)).body;
      assert.equal(gone.linkedBookings[0].status, null);

      const linkedBookingId = gone.linkedBookings[0].linkedBookingId;
      const unlinked = (await http().delete(`/api/itineraries/${id}/bookings/${linkedBookingId}`).set('Cookie', alice).expect(200)).body;
      assert.deepEqual(unlinked.linkedBookings, []);
      await http().delete(`/api/itineraries/${id}/bookings/${linkedBookingId}`).set('Cookie', alice).expect(404);
    });

    it('links a booked flight on its departure date and adds it to that day\'s transport', async () => {
      const { id, dayIds } = await tripWithDays();
      const flightId = flightBookings.add(await userIdOf('alice@example.com'), {
        amountMinor: 40000, bookingReference: 'FB-TEST1', label: 'MS777 CAI-LHR', startDate: '2026-12-22', endDate: undefined,
      });

      const wrongDay = await link(id, { type: 'FLIGHT', bookingId: flightId, dayId: dayIds[0] }).expect(400);
      assert.match(wrongDay.body.errors.dayId[0], /dated 2026-12-22.*this day is 2026-12-20/);
      const linked = (await link(id, { type: 'FLIGHT', bookingId: flightId, dayId: dayIds[2] }).expect(201)).body;
      assert.equal(linked.linkedBookings[0].type, 'FLIGHT');
      assert.equal(linked.linkedBookings[0].label, 'MS777 CAI-LHR');
      assert.equal(linked.linkedBookings[0].amount, 400);
      assert.equal(linked.linkedBookings[0].matchesDay, true);
      assert.equal('endDate' in linked.linkedBookings[0], false);

      const summary = (await http().get(`/api/itineraries/${id}/budget-summary`).set('Cookie', alice).expect(200)).body;
      assert.equal(summary.byDay[2].transport, 400);
      assert.equal(summary.byDay[2].total, 400);
      assert.equal(summary.totals.transport, 400);
      assert.equal(summary.totals.categories.ACCOMMODATION, 0);
      assert.equal(summary.totals.grandTotal, 400);
      assert.equal(summary.byCity.find((city: { city: string }) => city.city === 'London').total, 400);
      assert.deepEqual(
        (({ type, countsInBudget, convertedAmount }) => ({ type, countsInBudget, convertedAmount }))(summary.linkedBookings[0]),
        { type: 'FLIGHT', countsInBudget: true, convertedAmount: 400 },
      );

      // Linking the same flight again is a conflict.
      await link(id, { type: 'FLIGHT', bookingId: flightId, dayId: dayIds[2] }).expect(409);
    });

    it('keeps links owner-only: hidden from other viewers, their summaries and clones', async () => {
      const { id, dayIds } = await tripWithDays();
      await link(id, { type: 'HOTEL', bookingId: hotelBookings.add(await userIdOf('alice@example.com')), dayId: dayIds[0] }).expect(201);
      await http().patch(`/api/itineraries/${id}`).set('Cookie', alice).send({ visibility: 'PUBLIC' }).expect(200);

      const asBob = (await http().get(`/api/itineraries/${id}`).set('Cookie', bob).expect(200)).body;
      assert.equal(asBob.linkedBookings, undefined);
      assert.equal((await http().get(`/api/itineraries/public/${id}`).expect(200)).body.linkedBookings, undefined);
      const admin = await login('admin@example.com', { role: UserRole.ADMIN });
      assert.equal((await http().get(`/api/itineraries/${id}`).set('Cookie', admin).expect(200)).body.linkedBookings, undefined);

      const bobSummary = (await http().get(`/api/itineraries/${id}/budget-summary`).set('Cookie', bob).expect(200)).body;
      assert.equal(bobSummary.linkedBookings, undefined);
      assert.equal(bobSummary.totals.grandTotal, 0);
      const guestSummary = (await http().get(`/api/itineraries/${id}/budget-summary`).expect(200)).body;
      assert.equal(guestSummary.linkedBookings, undefined);

      const clone = (await http().post(`/api/itineraries/${id}/clone`).set('Cookie', bob).expect(201)).body;
      assert.deepEqual(clone.linkedBookings, []);
    });

    it('rejects other users, unbooked reservations and days outside the booking dates', async () => {
      const { id, dayIds } = await tripWithDays();
      const aliceId = await userIdOf('alice@example.com');
      const bookingId = hotelBookings.add(aliceId);

      await http().post(`/api/itineraries/${id}/bookings`).send({ type: 'HOTEL', bookingId, dayId: dayIds[0] }).expect(401);
      await link(id, { type: 'HOTEL', bookingId, dayId: dayIds[0] }, bob).expect(404); // not bob's itinerary
      const bobsTrip = await tripWithDays(bob);
      await link(bobsTrip.id, { type: 'HOTEL', bookingId, dayId: bobsTrip.dayIds[0] }, bob).expect(404); // not bob's booking

      for (const status of [BookingStatus.PENDING, BookingStatus.EXPIRED, BookingStatus.CANCELLED]) {
        const pending = hotelBookings.add(aliceId, { status });
        const response = await link(id, { type: 'HOTEL', bookingId: pending, dayId: dayIds[0] }).expect(400);
        assert.match(response.body.errors.bookingId[0], new RegExp(`this one is ${status}`));
      }
      const completed = hotelBookings.add(aliceId, { status: BookingStatus.COMPLETED });
      await link(id, { type: 'HOTEL', bookingId: completed, dayId: dayIds[1] }).expect(201);

      // Check-out day (2026-12-22) is not a night of the stay.
      const outside = await link(id, { type: 'HOTEL', bookingId, dayId: dayIds[2] }).expect(400);
      assert.match(outside.body.errors.dayId[0], /from 2026-12-20 to 2026-12-21.*this day is 2026-12-22/);
      const unknownDay = await link(id, { type: 'HOTEL', bookingId, dayId: new Types.ObjectId().toString() }).expect(400);
      assert.ok(unknownDay.body.errors.dayId);
      await link(id, { type: 'TRAIN', bookingId, dayId: dayIds[0] }).expect(400);
      await link(id, { type: 'HOTEL', bookingId: 'nope', dayId: dayIds[0] }).expect(400);
      await link(id, { type: 'HOTEL', bookingId: new Types.ObjectId().toString(), dayId: dayIds[0] }).expect(404);
      // A hotel booking id is not a flight booking.
      await link(id, { type: 'FLIGHT', bookingId, dayId: dayIds[0] }).expect(404);
      await http().delete(`/api/itineraries/${id}/bookings/${new Types.ObjectId()}`).set('Cookie', alice).expect(404);
    });

    it('moves links with their day, flags date mismatches and removes links with a deleted day', async () => {
      const { id, dayIds } = await tripWithDays();
      await link(id, { type: 'HOTEL', bookingId: hotelBookings.add(await userIdOf('alice@example.com')), dayId: dayIds[0] }).expect(201);
      // Day 1 becomes the third day (2026-12-22), which is the check-out day.
      const reordered = (await http().patch(`/api/itineraries/${id}/days/reorder`).set('Cookie', alice)
        .send({ dayIds: [dayIds[2], dayIds[1], dayIds[0]] }).expect(200)).body;
      assert.equal(reordered.linkedBookings[0].dayId, dayIds[0]);
      assert.equal(reordered.linkedBookings[0].matchesDay, false);
      const afterDelete = (await http().delete(`/api/itineraries/${id}/days/${dayIds[0]}`).set('Cookie', alice).expect(200)).body;
      assert.deepEqual(afterDelete.linkedBookings, []);
    });

    it('limits links per itinerary and fails closed when a lookup fails', async () => {
      const { id, dayIds } = await tripWithDays();
      const aliceId = await userIdOf('alice@example.com');
      for (let i = 0; i < 20; i += 1) await link(id, { type: 'HOTEL', bookingId: hotelBookings.add(aliceId), dayId: dayIds[0] }).expect(201);
      await link(id, { type: 'HOTEL', bookingId: hotelBookings.add(aliceId), dayId: dayIds[0] }).expect(409);

      hotelBookings.fail = true;
      await http().get(`/api/itineraries/${id}/budget-summary`).set('Cookie', alice).expect(500);
      await http().get(`/api/itineraries/${id}`).set('Cookie', alice).expect(500);
    });
  });

  describe('ITN-25/ITN-26 reuse of hotel and flight search', () => {
    it('passes room counts and airport-based one-way/round-trip criteria to the owning search ports', async () => {
      const id = await createItinerary();
      await addDay(id, 'Cairo');
      await addDay(id, 'Cairo');
      const body = await addDay(id, 'London');
      const dayId = body.days[0].dayId;
      await http().get(`/api/itineraries/${id}/hotels?dayId=${dayId}&guests=4&rooms=2`).set('Cookie', alice).expect(200);
      assert.deepEqual(hotels.criteria[0], { city: 'Cairo', countryCode: 'EG', checkIn: '2026-12-20', checkOut: '2026-12-22', guests: 4, rooms: 2 });
      await http().get(`/api/itineraries/${id}/flights?departureAirportCode=LHR&adults=2&infants=1`).set('Cookie', alice).expect(200);
      assert.deepEqual(flights.criteria[0], {
        departureAirportCode: 'LHR', arrivalAirportCodes: ['CAI'], roundTrip: false,
        departureDate: '2026-12-20', adults: 2, children: 0, infants: 1,
      });
      await http().get(`/api/itineraries/${id}/flights?departureAirportCode=LHR&roundTrip=true`).set('Cookie', alice).expect(200);
      assert.equal(flights.criteria[1].returnDate, '2026-12-22');
      await http().get(`/api/itineraries/${id}/flights?departureAirportCode=LHR&adults=10`).set('Cookie', alice).expect(200);
      assert.equal(flights.criteria[2].adults, 10, 'the itinerary does not invent a nine-passenger search limit');
      for (const query of ['departureAirportCode=XXX', 'departureAirportCode=CAI', 'departureAirportCode=LHR&adults=0',
        'departureAirportCode=LHR&infants=2', 'departureAirportCode=LHR&roundTrip=true&returnDate=2026-12-01',
        'departureAirportCode=LHR&returnDate=2026-12-22', 'departureAirportCode=LHR&roundTrip=garbage']) {
        await http().get(`/api/itineraries/${id}/flights?${query}`).set('Cookie', alice).expect(400);
      }
      await http().get(`/api/itineraries/${id}/hotels?dayId=${dayId}`).set('Cookie', bob).expect(404);
    });
  });

  it('uses shared status/name lookups with normalized IDs and no entries for missing/deactivated names', async () => {
    const service = app.get(UsersService);
    assert.equal(accountStatuses, service, 'the itinerary port reuses the shared service instance');
    const owner = await users.findOne({ email: 'alice@example.com' }).orFail();
    const other = await users.findOne({ email: 'bob@example.com' }).orFail();
    const ids = [owner._id.toString(), owner._id.toString().toUpperCase(), other._id.toString(), 'bad', '000000000000000000000000'];
    await setStatus('bob@example.com', AccountStatus.SUSPENDED);
    assert.deepEqual(await service.getAccountStatuses(ids), new Map([[owner._id.toString(), AccountStatus.ACTIVE], [other._id.toString(), AccountStatus.SUSPENDED]]));
    assert.deepEqual(await service.getDisplayNames(ids), new Map([[owner._id.toString(), 'alice'], [other._id.toString(), 'bob']]));
    await setStatus('bob@example.com', AccountStatus.DEACTIVATED);
    assert.equal((await service.getDisplayNames(ids)).has(other._id.toString()), false);
    assert.equal((await service.getAccountStatuses(ids)).get(other._id.toString()), AccountStatus.DEACTIVATED);
    assert.deepEqual(await service.getAccountStatuses(['bad']), new Map());
  });

  it('seeds one shared reference catalog idempotently and validates official country/city membership', async () => {
    const references = app.get(ReferenceDataService);
    const before = await connection.collection('cities').findOne({ cityId: 'cairo' });
    assert.deepEqual(await references.seedSupported(), { countries: 8, cities: 8 });
    const after = await connection.collection('cities').findOne({ cityId: 'cairo' });
    assert.equal(after!._id.toString(), before!._id.toString());
    assert.equal(after!.updatedAt.getTime(), before!.updatedAt.getTime());
    const countries = await http().get('/api/countries').expect(200);
    const cities = await http().get('/api/cities').expect(200);
    assert.equal(countries.body.length, 8);
    assert.equal(cities.body.length, 8);
    assert.ok(cities.body.some((row: { cityId: string }) => row.cityId === 'new_york'));
    assert.deepEqual(Object.keys(countries.body[0]).sort(), ['code', 'currency', 'name']);
    assert.deepEqual(Object.keys(cities.body[0]).sort(), ['cityId', 'countryCode', 'name']);
    const swagger = (await http().get('/api/docs-json').expect(200)).body;
    assert.ok(swagger.paths['/api/countries'].get.responses['200']);
    assert.ok(swagger.paths['/api/cities'].get.responses['200']);
    await http().post('/api/itineraries').set('Cookie', alice)
      .send({ title: 'Invalid', countries: ['ZZ'], startDate: '2026-12-20' }).expect(400);
    const id = await createItinerary();
    for (const body of [{ city: 'Made up city' }, { city: 'Cairo', countryCode: 'GB' }]) {
      await http().post(`/api/itineraries/${id}/days`).set('Cookie', alice).send(body).expect(400);
    }
    const valid = await addDay(id, ' cairo ');
    assert.equal(valid.days[0].city, 'Cairo');
    await http().patch(`/api/itineraries/${id}`).set('Cookie', alice).send({ countries: ['GB'] }).expect(400);
  });

  it('enforces the workbook title/day boundaries and rejects invalid null updates without mutation', async () => {
    const id = await createItinerary(alice, { title: 'a'.repeat(100) });
    await http().patch(`/api/itineraries/${id}`).set('Cookie', alice).send({ title: 'a'.repeat(101) }).expect(400);
    await http().patch(`/api/itineraries/${id}`).set('Cookie', alice).send({ countries: null }).expect(400);
    await http().patch(`/api/itineraries/${id}`).set('Cookie', alice).send({ visibility: null }).expect(400);
    await http().patch(`/api/itineraries/${id}`).set('Cookie', alice).send({ currency: null }).expect(400);
    await connection.collection('itineraries').updateOne({ _id: new Types.ObjectId(id) }, {
      $set: { days: Array.from({ length: 60 }, () => ({ _id: new Types.ObjectId(), city: 'Cairo', countryCode: 'EG', activities: [], budgets: [] })) },
    });
    await http().post(`/api/itineraries/${id}/days`).set('Cookie', alice).send({ city: 'Cairo' }).expect(409);
    const stored = (await http().get(`/api/itineraries/${id}`).set('Cookie', alice).expect(200)).body;
    assert.equal(stored.dayCount, 60);
    assert.equal(stored.title.length, 100);
  });

  it('counts activity costs and assigned transport in day/city totals and follows current profile preference', async () => {
    const id = await createItinerary(alice, { currency: 'USD', visibility: 'PUBLIC' });
    const dayId = (await addDay(id, 'Cairo')).days[0].dayId;
    const path = `/api/itineraries/${id}/days/${dayId}/activities`;
    const activity = (await http().post(path).set('Cookie', alice).send({ title: 'Museum', cost: 10 }).expect(201)).body.days[0].activities[0];
    assert.equal(activity.currency, 'USD');
    await http().post(path).set('Cookie', alice).send({ title: 'Lunch tour', cost: 500, currency: 'EGP' }).expect(201);
    await http().post(path).set('Cookie', alice).send({ title: 'Free', cost: 0, currency: 'EGP' }).expect(201);
    for (const fields of [{ cost: -1 }, { cost: null }, { cost: 2.111 }, { cost: 1, currency: 'CHF' }, { currency: 'USD' }]) {
      await http().post(path).set('Cookie', alice).send({ title: 'Bad', ...fields }).expect(400);
    }
    await http().post(`/api/itineraries/${id}/transport-costs`).set('Cookie', alice)
      .send({ mode: 'BUS', fromCity: 'Cairo', toCity: 'London', amount: 5, currency: 'USD' }).expect(400);
    await http().post(`/api/itineraries/${id}/transport-costs`).set('Cookie', alice)
      .send({ mode: 'BUS', fromCity: 'Cairo', toCity: 'London', amount: 5, currency: 'USD', dayId }).expect(201);
    const summary = (await http().get(`/api/itineraries/${id}/budget-summary`).set('Cookie', alice).expect(200)).body;
    assert.equal(summary.totals.categories.ACTIVITIES, 20);
    assert.equal(summary.totals.grandTotal, 25);
    assert.equal(summary.byDay[0].total, 25);
    assert.equal(summary.byDay[0].transport, 5);
    assert.equal(summary.byCity[0].total, 25);
    const clone = (await http().post(`/api/itineraries/${id}/clone`).set('Cookie', bob).expect(201)).body;
    assert.deepEqual(clone.days[0].activities.map((a: { cost: number }) => a.cost), [10, 500, 0]);
    await http().patch('/api/users/me').set('Cookie', alice).send({ preferredCurrency: 'EGP' }).expect(200);
    const preferred = (await http().get(`/api/itineraries/${id}/budget-summary`).set('Cookie', alice).expect(200)).body;
    assert.equal(preferred.currency, 'EGP');
    assert.equal(preferred.totals.grandTotal, 1250);
  });

  it('keeps legacy unassigned transport readable and allows explicit reassignment without a destructive migration', async () => {
    const id = await createItinerary();
    const dayId = (await addDay(id, 'Cairo')).days[0].dayId;
    const costId = new Types.ObjectId();
    await connection.collection('itineraries').updateOne({ _id: new Types.ObjectId(id) }, { $set: { transportCosts: [{
      _id: costId, fromCity: 'Cairo', toCity: 'London', mode: 'BUS', amount: 10, currency: 'USD',
    }] } });
    await http().patch(`/api/itineraries/${id}`).set('Cookie', alice).send({ title: 'Still editable' }).expect(200);
    await http().patch(`/api/transport-costs/${costId}`).set('Cookie', alice).send({ amount: 20 }).expect(400);
    await http().patch(`/api/transport-costs/${costId}`).set('Cookie', alice).send({ dayId }).expect(200);
    const summary = (await http().get(`/api/itineraries/${id}/budget-summary`).set('Cookie', alice).expect(200)).body;
    assert.equal(summary.byDay[0].total, 10);
    assert.equal(summary.totals.grandTotal, 10);
  });

  it('matches country names in public keyword search and rejects WebP uploads', async () => {
    const id = await createItinerary(alice, { title: 'Ordinary', countries: ['EG'], visibility: 'PUBLIC' });
    const dayId = (await addDay(id, 'Cairo')).days[0].dayId;
    const activity = (await http().post(`/api/itineraries/${id}/days/${dayId}/activities`).set('Cookie', alice).send({ title: 'Museum' }).expect(201)).body.days[0].activities[0];
    const matches = (await http().get('/api/itineraries/public/search?q=Egypt').expect(200)).body;
    assert.equal(matches.total, 1);
    await http().post(`/api/activities/${activity.activityId}/images`).set('Cookie', alice)
      .attach('image', Buffer.from('RIFF0000WEBP'), { filename: 'bad.webp', contentType: 'image/webp' }).expect(400);
    await setStatus('alice@example.com', AccountStatus.DEACTIVATED);
    assert.equal((await http().get('/api/itineraries/public/search?q=Egypt').expect(200)).body.total, 0);
  });

  it('shares concurrent FX fetches and reuses a snapshot from the current UTC day', async () => {
    const id = await createItinerary(alice, { currency: 'USD' });
    const dayId = (await addDay(id, 'Cairo')).days[0].dayId;
    await http().post(`/api/itineraries/${id}/days/${dayId}/budgets`).set('Cookie', alice)
      .send({ category: 'FOOD', amount: 500, currency: 'EGP' }).expect(201);
    await Promise.all(Array.from({ length: 4 }, () =>
      http().get(`/api/itineraries/${id}/budget-summary`).set('Cookie', alice).expect(200)));
    assert.equal(fx.calls, 1);
    const now = new Date();
    await connection.collection('exchangerates').updateMany({}, { $set: { fetchedAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) } });
    await http().get(`/api/itineraries/${id}/budget-summary`).set('Cookie', alice).expect(200);
    assert.equal(fx.calls, 1, 'a snapshot from earlier today still satisfies the daily cache');
  });

  it('rejects an edit based on a stale copy (optimistic concurrency)', async () => {
    const id = await createItinerary();
    const model = connection.model<Itinerary>(Itinerary.name);
    const first = await model.findById(id).orFail();
    const second = await model.findById(id).orFail();
    first.days.push({ city: 'Cairo', activities: [], budgets: [] } as never);
    await first.save();
    second.days.push({ city: 'London', activities: [], budgets: [] } as never);
    await assert.rejects(second.save());
  });

});
