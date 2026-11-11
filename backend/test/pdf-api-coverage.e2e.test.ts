import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it, mock } from 'node:test';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request, { Response } from 'supertest';
import { AirportsService } from '../src/airports/airports.service';
import { UserRole } from '../src/common/enums/user-role.enum';
import { configureApplication } from '../src/configure-application';
import { CurrenciesService } from '../src/currencies/currencies.service';
import { ReferenceDataService } from '../src/reference-data/reference-data.service';

/**
 * Checks against the project description PDF (section 8 endpoint tables) on the real root module:
 * every listed endpoint exists at its PDF path, the PDF-path aliases behave like the original routes,
 * and the audit fixes (empty edits, FLT-05 airports, FLT-12 dates, HTL-02 details, HTL-06 deletion).
 */

const PDF_ENDPOINTS = `
POST /api/auth/register|POST /api/auth/login|POST /api/auth/logout|POST /api/auth/forgot-password|POST /api/auth/reset-password
POST /api/admin/users/{}/reset-password|PATCH /api/auth/change-password|GET /api/auth/me|GET /api/users/me|PATCH /api/users/me|DELETE /api/users/me
POST /api/admin/moderators|GET /api/admin/accounts|PATCH /api/admin/accounts/{}/suspend|PATCH /api/admin/accounts/{}/reactivate
PATCH /api/admin/providers/{}/{}/deactivate|PATCH /api/admin/providers/{}/{}/reactivate|GET /api/admin/bookings|GET /api/admin/reports
PATCH /api/admin/reports/{}|DELETE /api/admin/content/{}/{}|GET /api/admin/audit-logs
POST /api/airlines|GET /api/airlines/{}|PATCH /api/airlines/{}|GET /api/airports|POST /api/flights|GET /api/flights/search|GET /api/flights/{}
PATCH /api/flights/{}|POST /api/flights/{}/cancel|POST /api/flights/{}/cabins|PATCH /api/flights/{}/cabins/{}|PUT /api/airlines/{}/baggage-policy
PUT /api/airlines/{}/cancellation-policy|GET /api/flights/{}/bookings|GET /api/flights/{}/passengers/export
POST /api/flight-bookings/hold|POST /api/flight-bookings|GET /api/flight-bookings|GET /api/flight-bookings/{}|POST /api/flight-bookings/{}/cancel
PATCH /api/flight-bookings/{}/change-flight|GET /api/flight-bookings/{}/e-ticket|PATCH /api/flight-bookings/{}/seat
POST /api/hotels|GET /api/hotels/search|GET /api/hotels/{}|PATCH /api/hotels/{}|POST /api/hotels/{}/rooms|PATCH /api/hotels/{}/rooms/{}
DELETE /api/hotels/{}/rooms/{}|GET /api/hotels/{}/rooms/available|POST /api/hotels/{}/rooms/{}/availability|PATCH /api/hotels/{}/rooms/{}/availability
GET /api/hotels/{}/availability|PUT /api/hotels/{}/policies|GET /api/hotels/{}/reservations
POST /api/hotel-bookings|GET /api/hotel-bookings|GET /api/hotel-bookings/{}|POST /api/hotel-bookings/{}/cancel|POST /api/hotel-bookings/{}/review
PATCH /api/reviews/{}|DELETE /api/reviews/{}|GET /api/hotels/{}/reviews|POST /api/reviews/{}/reply
GET /api/bookings/{}/{}/policies|POST /api/bookings/{}/{}/accept-policies|POST /api/payments|POST /api/payments/{}/retry|GET /api/payments/{}
POST /api/payments/webhook|GET /api/refunds/{}
POST /api/itineraries|GET /api/itineraries|GET /api/itineraries/{}|PATCH /api/itineraries/{}|DELETE /api/itineraries/{}|POST /api/itineraries/{}/days
PATCH /api/itineraries/{}/days/{}|DELETE /api/itineraries/{}/days/{}|PATCH /api/itineraries/{}/days/reorder|POST /api/itineraries/{}/days/{}/activities
PATCH /api/activities/{}|DELETE /api/activities/{}|POST /api/activities/{}/images|DELETE /api/activities/{}/images/{}
POST /api/itineraries/{}/days/{}/budgets|PATCH /api/budgets/{}|DELETE /api/budgets/{}|POST /api/itineraries/{}/transport-costs
PATCH /api/transport-costs/{}|DELETE /api/transport-costs/{}|GET /api/itineraries/{}/budget-summary|GET /api/itineraries/public/search
GET /api/itineraries/public/{}|POST /api/itineraries/{}/clone|GET /api/itineraries/{}/hotels|GET /api/itineraries/{}/flights
POST /api/itineraries/{}/bookings|GET /api/itineraries/{}/pdf
POST /api/posts|GET /api/posts|GET /api/posts/{}|GET /api/posts/mine|PATCH /api/posts/{}|DELETE /api/posts/{}|POST /api/posts/{}/comments
PATCH /api/comments/{}|DELETE /api/comments/{}|POST /api/posts/{}/like|DELETE /api/posts/{}/like|POST /api/posts/{}/images
DELETE /api/posts/{}/images/{}|GET /api/tags/{}/posts|GET /api/authors/{}|PATCH /api/posts/{}/itinerary`
  .split(/[|\n]/).map((line) => line.trim()).filter(Boolean);

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function cookies(response: Response): string {
  return (response.headers['set-cookie'] as unknown as string[]).map((cookie) => cookie.split(';')[0]).join('; ');
}

describe('PDF API coverage and audit fixes (root module)', { concurrency: false }, () => {
  let app: INestApplication;
  let replicaSet: MongoMemoryReplSet;
  let connection: Connection;
  const previousEnvironment = new Map<string, string | undefined>();
  let admin: string;
  let alice: { cookie: string; userId: string };
  let airMod: string;
  let otherAirMod: string;
  let hotMod: string;
  let airlineId: string;
  let otherAirlineId: string;
  let hotelId: string;

  const http = () => request(app.getHttpServer());

  async function account(email: string, role = UserRole.USER) {
    await http().post('/api/auth/register').send({ name: `Coverage ${email.split('@')[0]}`, email, password: 'Travel123', termsAccepted: true }).expect(201);
    await connection.collection('users').updateOne({ email }, { $set: { role } });
    const response = await http().post('/api/auth/login').set('Sec-Fetch-Site', 'same-origin').send({ email, password: 'Travel123' }).expect(200);
    return { cookie: cookies(response), userId: response.body.userId as string };
  }

  async function assign(moderatorId: string, provider: { airlineId?: string; hotelId?: string }) {
    await connection.collection('moderatorassignments').insertOne({
      moderatorId: new Types.ObjectId(moderatorId),
      ...(provider.airlineId ? { airlineId: new Types.ObjectId(provider.airlineId) } : {}),
      ...(provider.hotelId ? { hotelId: new Types.ObjectId(provider.hotelId) } : {}),
    });
  }

  before(async () => {
    replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    const environment = {
      MONGODB_URI: replicaSet.getUri('pdf-api-coverage'), JWT_SECRET: randomBytes(48).toString('hex'), PORT: '3000',
      STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', FXRATES_API_KEY: '', SMTP_HOST: '', SMTP_PORT: '', SMTP_USER: '', SMTP_PASS: '',
      SMTP_FROM: '', PASSWORD_RESET_URL: '', EMAIL_VERIFICATION_URL: '', EMAIL_VERIFICATION_REQUIRED: 'false',
    };
    for (const [key, value] of Object.entries(environment)) {
      previousEnvironment.set(key, process.env[key]);
      process.env[key] = value;
    }
    // The real root module, without reading anyone's private .env file.
    const original = ConfigModule.forRoot.bind(ConfigModule);
    const config = mock.method(ConfigModule, 'forRoot', (options?: Parameters<typeof ConfigModule.forRoot>[0]) => original({ ...options, ignoreEnvFile: true }));
    let rootModule;
    try {
      rootModule = (await import('../src/app.module')).AppModule;
    } finally {
      config.mock.restore();
    }
    const testing = await Test.createTestingModule({ imports: [rootModule] }).compile();
    app = testing.createNestApplication({ rawBody: true });
    configureApplication(app);
    await app.init();
    connection = testing.get(getConnectionToken());
    await Promise.all(Object.values(connection.models).map((model) => model.init()));
    await testing.get(ReferenceDataService).seedSupported();
    await testing.get(AirportsService).seedPredefined();
    await testing.get(CurrenciesService).seedSupported();

    admin = (await account('coverage-admin@example.com', UserRole.ADMIN)).cookie;
    alice = await account('coverage-alice@example.com');
    airlineId = (await http().post('/api/airlines').set('Cookie', admin).send({ name: 'Coverage Air', code: 'CVA' }).expect(201)).body._id;
    otherAirlineId = (await http().post('/api/airlines').set('Cookie', admin).send({ name: 'Other Air', code: 'OTA' }).expect(201)).body._id;
    hotelId = (await http().post('/api/hotels').set('Cookie', admin)
      .send({ name: 'Coverage Hotel', city: 'Cairo', address: '1 Nile St', starClass: 4, amenities: ['Pool'] }).expect(201)).body._id;
    const air = await account('coverage-air@example.com', UserRole.AIRLINE_MODERATOR);
    await assign(air.userId, { airlineId });
    airMod = air.cookie;
    const otherAir = await account('coverage-other-air@example.com', UserRole.AIRLINE_MODERATOR);
    await assign(otherAir.userId, { airlineId: otherAirlineId });
    otherAirMod = otherAir.cookie;
    const hot = await account('coverage-hotel@example.com', UserRole.HOTEL_MODERATOR);
    await assign(hot.userId, { hotelId });
    hotMod = hot.cookie;
  }, { timeout: 30 * 60_000 });

  after(async () => {
    await app?.close();
    await replicaSet?.stop();
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }, { timeout: 60_000 });

  it('exposes every endpoint of the PDF section 8 tables at its PDF path (optional ACC-02 GET verify-email aside)', async () => {
    const document = (await http().get('/api/docs-json').expect(200)).body as { paths: Record<string, Record<string, unknown>> };
    const available = new Set(Object.entries(document.paths)
      .flatMap(([path, operations]) => Object.keys(operations).map((method) => `${method.toUpperCase()} ${path.replace(/\{[^}]+\}/g, '{}')}`)));
    const missing = PDF_ENDPOINTS.filter((endpoint) => !available.has(endpoint));
    assert.deepEqual(missing, []);
  });

  it('rejects empty profile, flight and cabin edits instead of reporting success (GEN-02)', async () => {
    const flight = (await http().post('/api/flights').set('Cookie', airMod).send({
      flightNumber: 'CV001', departureAirportCode: 'CAI', arrivalAirportCode: 'DXB',
      departureLocalDateTime: `${day(30)}T10:00`, arrivalLocalDateTime: `${day(30)}T15:00`,
    }).expect(201)).body;
    const [cabin] = (await http().post(`/api/flights/${flight._id}/cabins`).set('Cookie', airMod)
      .send({ cabins: [{ cabinClass: 'ECONOMY', totalSeats: 5, price: 10000, baggageAllowanceCount: 1, baggageMaxWeightKg: 23 }] }).expect(201)).body;
    await http().patch(`/api/flights/${flight._id}`).set('Cookie', airMod).send({}).expect(400);
    await http().patch(`/api/flights/${flight._id}/cabins/${cabin._id}`).set('Cookie', airMod).send({}).expect(400);
    await http().patch('/api/airlines/me').set('Cookie', airMod).send({}).expect(400);
    await http().patch(`/api/flights/${flight._id}/cabins/${cabin._id}`).set('Cookie', airMod).send({ price: 12000 }).expect(200);
  });

  it('edits the airline by id and sets baggage/cancellation policies with PUT, only for the own airline (FLT-01, FLT-08, FLT-09)', async () => {
    const renamed = await http().patch(`/api/airlines/${airlineId}`).set('Cookie', airMod).send({ name: 'Coverage Airways' }).expect(200);
    assert.equal(renamed.body.name, 'Coverage Airways');
    await http().patch(`/api/airlines/${otherAirlineId}`).set('Cookie', airMod).send({ name: 'Hijack' }).expect(404);
    await http().patch(`/api/airlines/${airlineId}`).set('Cookie', alice.cookie).send({ name: 'x' }).expect(403);

    const baggage = await http().put(`/api/airlines/${airlineId}/baggage-policy`).set('Cookie', airMod)
      .send({ pricePerExtraBag: 2500, maxExtraBagsPerPassenger: 2 }).expect(200);
    assert.deepEqual({ ...baggage.body.baggagePolicy }, { pricePerExtraBag: 2500, maxExtraBagsPerPassenger: 2 });
    await http().put(`/api/airlines/${airlineId}/baggage-policy`).set('Cookie', airMod).send({ pricePerExtraBag: 0, maxExtraBagsPerPassenger: 2 }).expect(400);

    const tiers = await http().put(`/api/airlines/${airlineId}/cancellation-policy`).set('Cookie', airMod)
      .send({ cancellationTiers: [{ daysBeforeDeparture: 1, refundPercentage: 25 }, { daysBeforeDeparture: 14, refundPercentage: 90 }] }).expect(200);
    assert.deepEqual(tiers.body.cancellationTiers.map((tier: { daysBeforeDeparture: number }) => tier.daysBeforeDeparture), [14, 1]);
    await http().put(`/api/airlines/${airlineId}/cancellation-policy`).set('Cookie', airMod)
      .send({ cancellationTiers: [{ daysBeforeDeparture: 3, refundPercentage: 25 }, { daysBeforeDeparture: 3, refundPercentage: 90 }] }).expect(400);
    await http().put(`/api/airlines/${otherAirlineId}/cancellation-policy`).set('Cookie', airMod).send({ cancellationTiers: [] }).expect(404);
    const other = await connection.collection('airlines').findOne({ _id: new Types.ObjectId(otherAirlineId) });
    assert.equal(other!.name, 'Other Air', 'the other airline is untouched');
  });

  it('changes airports only while the flight has no booking (FLT-05)', async () => {
    const flight = (await http().post('/api/flights').set('Cookie', airMod).send({
      flightNumber: 'CV100', departureAirportCode: 'CAI', arrivalAirportCode: 'DXB',
      departureLocalDateTime: `${day(40)}T10:00`, arrivalLocalDateTime: `${day(40)}T15:00`,
    }).expect(201)).body;
    await http().patch(`/api/flights/${flight._id}`).set('Cookie', airMod).send({ arrivalAirportCode: 'CAI' }).expect(400);
    await http().patch(`/api/flights/${flight._id}`).set('Cookie', airMod).send({ arrivalAirportCode: 'ZZZ' }).expect(400);
    const moved = await http().patch(`/api/flights/${flight._id}`).set('Cookie', airMod).send({ arrivalAirportCode: 'LHR' }).expect(200);
    const lhr = await connection.collection('airports').findOne({ code: 'LHR' });
    assert.equal(String(moved.body.arrivalAirportId), String(lhr!._id));

    const [cabin] = (await http().post(`/api/flights/${flight._id}/cabins`).set('Cookie', airMod)
      .send({ cabins: [{ cabinClass: 'ECONOMY', totalSeats: 5, price: 10000, baggageAllowanceCount: 1, baggageMaxWeightKg: 23 }] }).expect(201)).body;
    await http().post('/api/flight-bookings/hold').set('Cookie', alice.cookie).send({
      segments: [{ flightId: flight._id, cabinId: cabin._id }],
      passengers: [{ fullName: 'Alice Coverage', dateOfBirth: '1990-01-01', documentNumber: 'A1234567', type: 'ADULT' }],
    }).expect(201);
    const refused = await http().patch(`/api/flights/${flight._id}`).set('Cookie', airMod).send({ arrivalAirportCode: 'DXB' }).expect(409);
    assert.match(refused.body.message, /any booking/);
    const stored = await connection.collection('flights').findOne({ _id: new Types.ObjectId(flight._id) });
    assert.equal(String(stored!.arrivalAirportId), String(lhr!._id), 'airports unchanged');
    // Times stay editable after a booking.
    await http().patch(`/api/flights/${flight._id}`).set('Cookie', airMod).send({ arrivalLocalDateTime: `${day(40)}T16:00` }).expect(200);
  });

  it('accepts same-day round-trip searches and rejects impossible dates (FLT-11, FLT-12)', async () => {
    const date = day(50);
    const base = { departureAirportCode: 'CAI', arrivalAirportCode: 'DXB', adults: 1, children: 0, infants: 0 };
    await http().get('/api/flights/search').query({ ...base, roundTrip: true, departureDate: date, returnDate: date }).expect(200);
    await http().get('/api/flights/search').query({ ...base, roundTrip: true, departureDate: date, returnDate: day(49) }).expect(400);
    await http().get('/api/flights/search').query({ ...base, roundTrip: false, departureDate: '2027-02-30' }).expect(400);
  });

  it('exports the passenger CSV at the PDF path (FLT-29)', async () => {
    const flight = (await http().post('/api/flights').set('Cookie', airMod).send({
      flightNumber: 'CV200', departureAirportCode: 'CAI', arrivalAirportCode: 'DXB',
      departureLocalDateTime: `${day(45)}T10:00`, arrivalLocalDateTime: `${day(45)}T15:00`,
    }).expect(201)).body;
    const csv = await http().get(`/api/flights/${flight._id}/passengers/export`).set('Cookie', airMod).expect(200);
    assert.match(String(csv.headers['content-type']), /text\/csv/);
    const original = await http().get(`/api/flights/${flight._id}/bookings/export.csv`).set('Cookie', airMod).expect(200);
    assert.equal(csv.text, original.text);
    await http().get(`/api/flights/${flight._id}/passengers/export`).set('Cookie', otherAirMod).expect(404);
  });

  it('shows reviews and dated available rooms on the hotel details page (HTL-02)', async () => {
    const room = (await http().post(`/api/hotels/${hotelId}/rooms`).set('Cookie', hotMod)
      .send({ name: '201', type: 'Double', beds: 1, capacity: 2, pricePerNight: 9000 }).expect(201)).body;
    await http().put(`/api/hotels/${hotelId}/rooms/${room._id}/bookable-ranges`).set('Cookie', hotMod)
      .send({ ranges: [{ startDate: day(1), endDate: day(300) }] }).expect(200);

    const plain = await http().get(`/api/hotels/${hotelId}`).expect(200);
    assert.equal(plain.body.hotelId, hotelId);
    assert.deepEqual(plain.body.amenities, ['Pool']);
    assert.equal(plain.body.availableRooms, null);
    assert.deepEqual({ items: plain.body.reviews.items, total: plain.body.reviews.total }, { items: [], total: 0 });
    assert.equal(plain.body.averageRating, null);

    const dated = await http().get(`/api/hotels/${hotelId}`).query({ checkIn: day(20), checkOut: day(23), guests: 2 }).expect(200);
    assert.equal(dated.body.availableRooms.total, 1);
    assert.equal(dated.body.availableRooms.items[0].roomId, room._id);
    assert.equal(dated.body.availableRooms.items[0].totalStayPrice, 27000);
    const tooMany = await http().get(`/api/hotels/${hotelId}`).query({ checkIn: day(20), checkOut: day(23), guests: 3 }).expect(200);
    assert.equal(tooMany.body.availableRooms.total, 0);

    await http().get(`/api/hotels/${hotelId}`).query({ checkIn: day(20) }).expect(400);
    await http().get(`/api/hotels/${hotelId}`).query({ checkIn: '2027-02-30', checkOut: '2027-03-02' }).expect(400);
    await http().get(`/api/hotels/${hotelId}`).query({ checkIn: '2020-01-01', checkOut: '2020-01-03' }).expect(400);
  });

  it('deactivates the own account with DELETE /api/users/me (ACC-12)', async () => {
    const carol = await account('coverage-carol@example.com');
    await http().delete('/api/users/me').set('Cookie', carol.cookie).set('Sec-Fetch-Site', 'same-origin').send({}).expect(400);
    await http().delete('/api/users/me').set('Cookie', carol.cookie).set('Sec-Fetch-Site', 'same-origin').send({ confirmed: true }).expect(204);
    await http().get('/api/auth/me').set('Cookie', carol.cookie).expect(401);
    await http().post('/api/auth/login').set('Sec-Fetch-Site', 'same-origin').send({ email: 'coverage-carol@example.com', password: 'Travel123' }).expect(401);
    const stored = await connection.collection('users').findOne({ email: 'coverage-carol@example.com' });
    assert.equal(stored!.status, 'DEACTIVATED', 'deactivated, not erased');
  });

  it('attaches and detaches an own public itinerary with PATCH /api/posts/:id/itinerary (BLG-13)', async () => {
    const itinerary = (await http().post('/api/itineraries').set('Cookie', alice.cookie)
      .send({ title: 'Coverage trip', countries: ['EG'], startDate: day(10) }).expect(201)).body;
    const post = (await http().post('/api/posts').set('Cookie', alice.cookie)
      .send({ title: 'Coverage post', content: 'Body', status: 'PUBLISHED' }).expect(201)).body;
    const postId = post.postId ?? post._id;

    // Private itineraries cannot be attached.
    await http().patch(`/api/posts/${postId}/itinerary`).set('Cookie', alice.cookie).send({ itineraryId: itinerary.itineraryId }).expect(400);
    await http().patch(`/api/itineraries/${itinerary.itineraryId}`).set('Cookie', alice.cookie).send({ visibility: 'PUBLIC' }).expect(200);
    const attached = await http().patch(`/api/posts/${postId}/itinerary`).set('Cookie', alice.cookie).send({ itineraryId: itinerary.itineraryId }).expect(200);
    assert.equal(attached.body.itinerary?.itineraryId, itinerary.itineraryId);

    const bob = await account('coverage-bob@example.com');
    await http().patch(`/api/posts/${postId}/itinerary`).set('Cookie', bob.cookie).send({ itineraryId: null }).expect(403);
    await http().patch(`/api/posts/${postId}/itinerary`).set('Cookie', alice.cookie).send({}).expect(400);
    const detached = await http().patch(`/api/posts/${postId}/itinerary`).set('Cookie', alice.cookie).send({ itineraryId: null }).expect(200);
    assert.ok(!detached.body.itinerary, 'detached');
  });
});
