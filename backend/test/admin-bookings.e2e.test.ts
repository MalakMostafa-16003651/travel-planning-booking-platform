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

  it('ACC-17: hotel bookings report as not available yet', async () => {
    const response = await list('?type=HOTEL').expect(503);
    assert.match(response.body.message, /not available yet/);
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
