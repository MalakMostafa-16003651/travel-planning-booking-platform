import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { AdminModule } from '../src/admin/admin.module';
import { UserRole } from '../src/common/enums/user-role.enum';
import { AdminFixture, Session } from './admin-fixture';

describe('ACC-17 admin bookings view', { concurrency: false }, () => {
  const fixture = new AdminFixture([AdminModule]);
  let admin: Session;
  let nour: Session;
  let airlineId: string;

  const collection = (name: string) => fixture.connection.collection(name);
  const list = (query = '', session = admin) => fixture.http().get(`/api/admin/bookings${query}`).set('Cookie', session.cookie);
  const addBooking = (fields: { status: string; departureAt: string; reference?: string; amount?: number }) =>
    collection('flightbookings').insertOne({
      userId: new Types.ObjectId(nour.userId),
      segments: [{ airlineId: new Types.ObjectId(airlineId), flightId: new Types.ObjectId(), departureAt: new Date(fields.departureAt) }],
      passengers: [{ fullName: 'Nour Explorer', documentNumber: 'A1234567', dateOfBirth: new Date('1995-01-01'), type: 'ADULT' }],
      totalAmount: fields.amount ?? 5000,
      currency: 'EGP',
      status: fields.status,
      bookingReference: fields.reference,
    });

  before(() => fixture.start('admin-bookings'), { timeout: 30 * 60_000 });
  after(() => fixture.stop());

  beforeEach(async () => {
    await fixture.reset();
    admin = await fixture.login('admin@example.com', UserRole.ADMIN);
    nour = await fixture.login('nour@example.com', UserRole.USER, 'Nour Explorer');
    airlineId = (await collection('airlines').insertOne({ name: 'Nile Air', code: 'NA', isActive: true })).insertedId.toString();
  });

  it('ACC-17: lists bookings with reference, user, provider, date, amount and status, without passenger documents', async () => {
    await addBooking({ status: 'CONFIRMED', departureAt: '2026-12-10T08:00:00Z', reference: 'NA7K2P', amount: 7200 });

    const response = await list().expect(200);
    assert.equal(response.body.total, 1);
    assert.equal(response.body.pageSize, 10);
    const [booking] = response.body.items;
    assert.equal(booking.type, 'FLIGHT');
    assert.equal(booking.bookingReference, 'NA7K2P');
    assert.equal(booking.userId, nour.userId);
    assert.equal(booking.userName, 'Nour Explorer');
    assert.equal(booking.userEmail, 'nour@example.com');
    assert.equal(booking.providerId, airlineId);
    assert.equal(booking.providerName, 'Nile Air');
    assert.equal(booking.startDate, '2026-12-10T08:00:00.000Z');
    assert.equal(booking.totalAmount, 7200);
    assert.equal(booking.currency, 'EGP');
    assert.equal(booking.status, 'CONFIRMED');
    assert.equal(JSON.stringify(response.body).includes('A1234567'), false);
    assert.equal(response.headers['cache-control'], 'no-store');
  });

  it('ACC-17: filters by status and travel-date range', async () => {
    await addBooking({ status: 'CONFIRMED', departureAt: '2026-12-10T08:00:00Z', reference: 'AAA111' });
    await addBooking({ status: 'CANCELLED', departureAt: '2026-12-20T08:00:00Z', reference: 'BBB222' });
    await addBooking({ status: 'PENDING', departureAt: '2027-01-05T08:00:00Z' });

    const references = async (query: string) =>
      (await list(query).expect(200)).body.items.map((item: { bookingReference?: string }) => item.bookingReference ?? 'none').sort();

    assert.deepEqual(await references('?status=CONFIRMED'), ['AAA111']);
    assert.deepEqual(await references('?from=2026-12-15&to=2026-12-31T23:59:59Z'), ['BBB222']);
    assert.deepEqual(await references('?from=2027-01-01'), ['none']);
    assert.deepEqual(await references('?type=FLIGHT&status=CANCELLED&to=2026-12-31'), ['BBB222']);
    assert.equal((await list('?status=COMPLETED').expect(200)).body.total, 0);
  });

  it('ACC-17/GEN-05: pages 10 at a time, newest booking first', async () => {
    for (let index = 0; index < 12; index += 1) {
      await addBooking({ status: 'CONFIRMED', departureAt: '2026-12-10T08:00:00Z', reference: `REF${String(index).padStart(3, '0')}` });
    }
    const first = await list().expect(200);
    assert.equal(first.body.total, 12);
    assert.equal(first.body.items.length, 10);
    assert.equal(first.body.items[0].bookingReference, 'REF011');
    assert.equal((await list('?page=2').expect(200)).body.items.length, 2);
  });

  it("ACC-17: lists hotel reservations through Person 6's listForAdmin, filtered by status and check-in date", async () => {
    const hotelId = new Types.ObjectId();
    const reservation = (fields: { status: string; checkIn: string; checkOut: string; reference?: string }) => ({
      userId: new Types.ObjectId(nour.userId),
      hotelId,
      hotelName: 'Cataract Hotel',
      rooms: [{ roomId: new Types.ObjectId(), roomName: 'Nile View Double', adults: 2, childrenAges: [] }],
      checkIn: fields.checkIn,
      checkOut: fields.checkOut,
      nights: 2,
      totalPrice: 9000,
      currency: 'EGP',
      status: fields.status,
      bookingReference: fields.reference,
    });
    await collection('hotelbookings').insertMany([
      reservation({ status: 'CONFIRMED', checkIn: '2026-12-10', checkOut: '2026-12-12', reference: 'H7K2M9QX' }),
      reservation({ status: 'CANCELLED', checkIn: '2026-12-20', checkOut: '2026-12-22', reference: 'H8L3N4PY' }),
    ]);
    await addBooking({ status: 'CONFIRMED', departureAt: '2026-12-10T08:00:00Z', reference: 'FLIGHT1' });

    const all = await list('?type=HOTEL').expect(200);
    assert.equal(all.body.total, 2);
    const confirmed = all.body.items.find((item: { bookingReference: string }) => item.bookingReference === 'H7K2M9QX');
    assert.equal(confirmed.type, 'HOTEL');
    assert.equal(confirmed.userName, 'Nour Explorer');
    assert.equal(confirmed.userEmail, 'nour@example.com');
    assert.equal(confirmed.providerId, hotelId.toString());
    assert.equal(confirmed.providerName, 'Cataract Hotel');
    assert.equal(confirmed.startDate, '2026-12-10T00:00:00.000Z');
    assert.equal(confirmed.endDate, '2026-12-12T00:00:00.000Z');
    assert.equal(confirmed.totalAmount, 9000);
    assert.equal(confirmed.status, 'CONFIRMED');

    const references = async (query: string) =>
      (await list(query).expect(200)).body.items.map((item: { bookingReference: string }) => item.bookingReference).sort();
    assert.deepEqual(await references('?type=HOTEL&status=CANCELLED'), ['H8L3N4PY']);
    // ISO date-times are reduced to the check-in calendar date Person 6 filters on.
    assert.deepEqual(await references('?type=HOTEL&from=2026-12-15T09:30:00Z'), ['H8L3N4PY']);
    assert.deepEqual(await references('?type=HOTEL&to=2026-12-10'), ['H7K2M9QX']);
    // type=FLIGHT lists flights only.
    assert.deepEqual(await references('?type=FLIGHT'), ['FLIGHT1']);
  });

  it('ACC-17: without a type, lists flights and hotels together, newest first, with one total and 10 per page', async () => {
    const hotelId = new Types.ObjectId();
    const addReservation = (reference: string, status = 'CONFIRMED', checkIn = '2026-12-10') => collection('hotelbookings').insertOne({
      userId: new Types.ObjectId(nour.userId), hotelId, hotelName: 'Cataract Hotel',
      rooms: [{ roomId: new Types.ObjectId(), roomName: 'Double', adults: 2, childrenAges: [] }],
      checkIn, checkOut: '2026-12-12', nights: 2, totalPrice: 9000, currency: 'EGP', status, bookingReference: reference,
    });
    // Created alternately, so the newest-first order interleaves the two kinds.
    for (let index = 0; index < 7; index += 1) {
      await addBooking({ status: 'CONFIRMED', departureAt: '2026-12-10T08:00:00Z', reference: `F${index}` });
      await addReservation(`H${index}`);
    }

    const first = await list().expect(200);
    assert.equal(first.body.total, 14);
    assert.equal(first.body.pageSize, 10);
    assert.deepEqual(first.body.items.map((item: { bookingReference: string }) => item.bookingReference),
      ['H6', 'F6', 'H5', 'F5', 'H4', 'F4', 'H3', 'F3', 'H2', 'F2']);
    assert.deepEqual(first.body.items.slice(0, 2).map((item: { type: string }) => item.type), ['HOTEL', 'FLIGHT']);
    const second = await list('?page=2').expect(200);
    assert.deepEqual(second.body.items.map((item: { bookingReference: string }) => item.bookingReference), ['H1', 'F1', 'H0', 'F0']);
    assert.equal((await list('?page=3').expect(200)).body.items.length, 0);

    // Filters apply to both kinds, and the total follows them.
    await addReservation('HCANCEL', 'CANCELLED', '2026-12-20');
    const cancelled = await list('?status=CANCELLED').expect(200);
    assert.equal(cancelled.body.total, 1);
    assert.equal(cancelled.body.items[0].bookingReference, 'HCANCEL');
  });

  it('ACC-17/GEN-13: rejects invalid filters', async () => {
    await list('?type=TRAIN').expect(400);
    await list('?status=LOST').expect(400);
    await list('?from=tomorrow').expect(400);
    await list('?from=2026-W45').expect(400);
    await list('?page=0').expect(400);
    await list('?userId=123').expect(400);
    const reversed = await list('?from=2026-12-31&to=2026-12-01').expect(400);
    assert.deepEqual(reversed.body.errors, { from: ['From must not be after To'] });
  });

  it('ACC-11/ACC-17: only administrators can see all bookings', async () => {
    await list('', nour).expect(403);
    const moderator = await fixture.login('desk@nileair.com', UserRole.AIRLINE_MODERATOR);
    await list('', moderator).expect(403);
    await fixture.http().get('/api/admin/bookings').expect(401);
  });

  it('lists the endpoint in Swagger with ACC-17', async () => {
    const document = (await fixture.http().get('/api/docs-json').expect(200)).body;
    assert.match(document.paths['/api/admin/bookings'].get.summary, /^ACC-17/);
  });
});
