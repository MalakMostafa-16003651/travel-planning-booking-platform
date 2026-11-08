import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { AdminModule } from '../src/admin/admin.module';
import { UserRole } from '../src/common/enums/user-role.enum';
import { AdminFixture, Session } from './admin-fixture';

describe('ACC-15 provider deactivation', { concurrency: false }, () => {
  const fixture = new AdminFixture([AdminModule]);
  let admin: Session;
  let airlineModerator: Session;
  let hotelModerator: Session;
  let customer: Session;
  let pendingCustomer: Session;
  let otherCustomer: Session;
  let airlineId: string;
  let otherAirlineId: string;
  let hotelId: string;

  const collection = (name: string) => fixture.connection.collection(name);
  const call = (action: 'deactivate' | 'reactivate', type: string, id: string, session = admin) =>
    fixture.http().patch(`/api/admin/providers/${type}/${id}/${action}`).set('Cookie', session.cookie).send({});
  const notificationsOf = (session: Session) => collection('notifications').find({ userId: new Types.ObjectId(session.userId) }).toArray();
  const booking = (userId: string, airline: string, status: string) => ({
    userId: new Types.ObjectId(userId),
    status,
    segments: [{ airlineId: new Types.ObjectId(airline), flightId: new Types.ObjectId() }],
  });

  before(() => fixture.start('admin-providers'), { timeout: 30 * 60_000 });
  after(() => fixture.stop());

  beforeEach(async () => {
    await fixture.reset();
    admin = await fixture.login('admin@example.com', UserRole.ADMIN);
    airlineModerator = await fixture.login('desk@nileair.com', UserRole.AIRLINE_MODERATOR);
    hotelModerator = await fixture.login('desk@hotel.com', UserRole.HOTEL_MODERATOR);
    customer = await fixture.login('nour@example.com');
    pendingCustomer = await fixture.login('pending@example.com');
    otherCustomer = await fixture.login('other@example.com');

    airlineId = (await collection('airlines').insertOne({ name: 'Nile Air', code: 'NA', isActive: true })).insertedId.toString();
    otherAirlineId = (await collection('airlines').insertOne({ name: 'Delta Sky', code: 'DS', isActive: true })).insertedId.toString();
    hotelId = (await collection('hotels').insertOne({ name: 'Cataract Hotel', city: 'Aswan', countryCode: 'EG', address: 'Corniche', isActive: true })).insertedId.toString();
    await collection('moderatorassignments').insertMany([
      { moderatorId: new Types.ObjectId(airlineModerator.userId), airlineId: new Types.ObjectId(airlineId) },
      { moderatorId: new Types.ObjectId(hotelModerator.userId), hotelId: new Types.ObjectId(hotelId) },
    ]);
    await collection('flightbookings').insertMany([
      booking(customer.userId, airlineId, 'CONFIRMED'),
      booking(customer.userId, airlineId, 'CONFIRMED'),
      booking(pendingCustomer.userId, airlineId, 'PENDING'),
      booking(otherCustomer.userId, otherAirlineId, 'CONFIRMED'),
    ]);
  });

  it('ACC-15: deactivates an airline, keeps its bookings, notifies its moderator and confirmed customers once', async () => {
    const response = await call('deactivate', 'airline', airlineId).expect(200);
    assert.deepEqual(response.body, { type: 'airline', providerId: airlineId, name: 'Nile Air', isActive: false, notifiedCount: 2 });

    const airline = await collection('airlines').findOne({ _id: new Types.ObjectId(airlineId) });
    assert.equal(airline!.isActive, false);
    assert.equal(await collection('flightbookings').countDocuments({ status: 'CONFIRMED' }), 3);

    const [moderatorNotice] = await notificationsOf(airlineModerator);
    assert.equal(moderatorNotice.type, 'PROVIDER_DEACTIVATED');
    assert.match(moderatorNotice.message, /Nile Air/);
    const customerNotices = await notificationsOf(customer);
    assert.equal(customerNotices.length, 1);
    assert.match(customerNotices[0].message, /remains valid/);
    assert.equal((await notificationsOf(pendingCustomer)).length, 0);
    assert.equal((await notificationsOf(otherCustomer)).length, 0);
    assert.equal((await collection('airlines').findOne({ _id: new Types.ObjectId(otherAirlineId) }))!.isActive, true);

    const [entry] = await collection('auditlogs').find().toArray();
    assert.equal(entry.action, 'PROVIDER_DEACTIVATED');
    assert.equal(entry.targetType, 'AIRLINE');
    assert.equal(entry.targetId.toString(), airlineId);
    assert.equal(entry.adminId.toString(), admin.userId);
  });

  it('ACC-15: deactivating a provider is separate from suspending its moderator', async () => {
    await call('deactivate', 'hotel', hotelId).expect(200);
    const moderator = await fixture.users.findById(hotelModerator.userId).exec();
    assert.equal(moderator!.status, 'ACTIVE');
    await fixture.http().get('/api/auth/me').set('Cookie', hotelModerator.cookie).expect(200);
  });

  it('ACC-15: deactivates and reactivates a hotel, notifying its moderator', async () => {
    const off = await call('deactivate', 'hotel', hotelId).expect(200);
    assert.equal(off.body.isActive, false);
    assert.equal(off.body.notifiedCount, 1);

    const on = await call('reactivate', 'hotel', hotelId).expect(200);
    assert.equal(on.body.isActive, true);
    assert.equal(on.body.notifiedCount, 1);
    assert.deepEqual((await notificationsOf(hotelModerator)).map((entry) => entry.type).sort(), ['PROVIDER_DEACTIVATED', 'PROVIDER_REACTIVATED']);
    assert.deepEqual((await collection('auditlogs').find().toArray()).map((entry) => entry.action).sort(), ['PROVIDER_DEACTIVATED', 'PROVIDER_REACTIVATED']);
  });

  it('ACC-15: reactivating an airline notifies its moderator but not its customers', async () => {
    await call('deactivate', 'airline', airlineId).expect(200);
    const response = await call('reactivate', 'airline', airlineId).expect(200);
    assert.equal(response.body.notifiedCount, 1);
    assert.equal((await notificationsOf(customer)).length, 1);
    assert.equal((await notificationsOf(airlineModerator)).length, 2);
  });

  it('ACC-15: rejects repeated, unknown and invalid requests without side effects', async () => {
    await call('reactivate', 'airline', airlineId).expect(409);
    await call('deactivate', 'airline', airlineId).expect(200);
    await call('deactivate', 'airline', airlineId).expect(409);
    await call('deactivate', 'hotel', new Types.ObjectId().toString()).expect(404);
    // A hotel ID is not an airline.
    await call('deactivate', 'airline', hotelId).expect(404);
    await call('deactivate', 'spaceship', airlineId).expect(400);
    await call('deactivate', 'airline', 'not-an-id').expect(400);
    assert.equal(await collection('auditlogs').countDocuments(), 1);
    assert.equal((await notificationsOf(customer)).length, 1);
  });

  it('ACC-15: two admins deactivating at once produce one change, one audit entry and one set of notifications', async () => {
    const results = await Promise.all([call('deactivate', 'airline', airlineId), call('deactivate', 'airline', airlineId)]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
    assert.equal(await collection('auditlogs').countDocuments(), 1);
    assert.equal((await notificationsOf(customer)).length, 1);
  });

  it('ACC-15: only administrators can change provider status', async () => {
    await call('deactivate', 'airline', airlineId, airlineModerator).expect(403);
    await call('deactivate', 'hotel', hotelId, hotelModerator).expect(403);
    await call('deactivate', 'airline', airlineId, customer).expect(403);
    await fixture.http().patch(`/api/admin/providers/airline/${airlineId}/deactivate`).send({}).expect(401);
    assert.equal((await collection('airlines').findOne({ _id: new Types.ObjectId(airlineId) }))!.isActive, true);
  });

  it('lists both endpoints in Swagger with ACC-15', async () => {
    const document = (await fixture.http().get('/api/docs-json').expect(200)).body;
    assert.match(document.paths['/api/admin/providers/{type}/{id}/deactivate'].patch.summary, /^ACC-15/);
    assert.match(document.paths['/api/admin/providers/{type}/{id}/reactivate'].patch.summary, /^ACC-15/);
  });
});
