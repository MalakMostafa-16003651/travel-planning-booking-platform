import { configureTestBookableRoom } from './hotel-test-data';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AdminModule } from '../src/admin/admin.module';
import { AuditLogsService } from '../src/audit-logs/audit-logs.service';
import { AccountStatus } from '../src/common/enums/account-status.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { HotelBookingsService } from '../src/hotel-bookings/hotel-bookings.service';
import { Hotel } from '../src/hotels/schemas/hotel.schema';
import { Room } from '../src/hotels/schemas/room.schema';
import { NotificationsService } from '../src/notifications/notifications.service';
import { AdminFixture, PASSWORD, Session } from './admin-fixture';

const TEMPORARY_PASSWORD = 'Temporary567';

describe('ACC-07a/GEN-07 atomic administrator actions', { concurrency: false }, () => {
  const fixture = new AdminFixture([AdminModule]);
  let admin: Session;
  let user: Session;
  let audits: AuditLogsService;
  let notices: NotificationsService;
  const collection = (name: string) => fixture.connection.collection(name);
  const reset = (userId = user.userId, body: object = { temporaryPassword: TEMPORARY_PASSWORD }, actor = admin) =>
    fixture.http().post(`/api/admin/users/${userId}/reset-password`).set('Cookie', actor.cookie).set('Sec-Fetch-Site', 'same-origin').send(body);
  const change = (operation: 'suspend' | 'reactivate', actor = admin) =>
    fixture.http().patch(`/api/admin/accounts/${user.userId}/${operation}`).set('Cookie', actor.cookie).send({ reason: 'Audited test action' });
  const credentials = () => fixture.users.findById(user.userId)
    .select('+passwordHash +credentialVersion +mustChangePassword +failedLoginAttempts +lockedUntil').lean().orFail().exec();
  const counts = async () => ({ audits: await collection('auditlogs').countDocuments({}), notifications: await collection('notifications').countDocuments({}) });

  before(async () => {
    await fixture.start('admin-audit-atomicity');
    audits = fixture.app.get(AuditLogsService);
    notices = fixture.app.get(NotificationsService);
  }, { timeout: 120_000 });
  after(() => fixture.stop());
  beforeEach(async () => {
    await fixture.reset();
    admin = await fixture.login('admin@example.com', UserRole.ADMIN, 'Reset Administrator');
    user = await fixture.login('user@example.com');
  });

  it('ACC-07a/GEN-07: commits the reset and actor-linked secret-free audit, invalidating the old session', async () => {
    const old = await credentials();
    await reset().expect(204);
    const stored = await credentials();
    assert.notEqual(stored.passwordHash, old.passwordHash);
    assert.equal(stored.mustChangePassword, true);
    assert.equal(stored.credentialVersion, old.credentialVersion + 1);
    assert.equal(stored.status, AccountStatus.ACTIVE);
    await fixture.http().get('/api/auth/me').set('Cookie', user.cookie).expect(401);
    const login = await fixture.http().post('/api/auth/login').send({ email: 'user@example.com', password: TEMPORARY_PASSWORD }).expect(200);
    assert.equal(login.body.passwordChangeRequired, true);
    const response = await fixture.http().get('/api/admin/audit-logs?action=PASSWORD_RESET&targetType=USER').set('Cookie', admin.cookie).expect(200);
    assert.equal(response.body.total, 1);
    const entry = response.body.items[0];
    assert.equal(entry.adminId, admin.userId);
    assert.equal(entry.targetId, user.userId);
    assert.equal(entry.targetType, 'USER');
    assert.equal(entry.action, 'PASSWORD_RESET');
    assert.equal(entry.adminName, 'Reset Administrator');
    const raw = await collection('auditlogs').findOne({ action: 'PASSWORD_RESET' });
    assert.ok(raw);
    assert.equal(raw.details, undefined);
    for (const secret of [TEMPORARY_PASSWORD, PASSWORD, stored.passwordHash, 'passwordHash', 'temporaryPassword']) {
      assert.equal(JSON.stringify(raw).includes(secret), false);
    }
  });

  it('ACC-07a: audit failure after the actual insert rolls credentials and audit back; retry succeeds once', async (context) => {
    const old = await credentials();
    const original = audits.log.bind(audits);
    const failure = context.mock.method(audits, 'log', async (...args: Parameters<AuditLogsService['log']>) => {
      await original(...args);
      throw new Error('Injected audit failure after insert');
    });
    try {
      const response = await reset().expect(500);
      assert.equal(response.body.message, 'An unexpected error occurred');
      assert.equal(response.headers['set-cookie'], undefined);
      const stored = await credentials();
      assert.equal(stored.passwordHash, old.passwordHash);
      assert.equal(stored.credentialVersion, old.credentialVersion);
      assert.equal(stored.mustChangePassword, old.mustChangePassword);
      assert.deepEqual(await counts(), { audits: 0, notifications: 0 });
      await fixture.http().get('/api/auth/me').set('Cookie', user.cookie).expect(200);
      await fixture.http().get('/api/auth/me').set('Cookie', admin.cookie).expect(200);
    } finally { failure.mock.restore(); }
    await reset().expect(204);
    assert.equal((await credentials()).credentialVersion, old.credentialVersion + 1);
    assert.equal(await collection('auditlogs').countDocuments({ action: 'PASSWORD_RESET' }), 1);
  });

  it('ACC-07a: forbidden, unknown and invalid requests create no audit and cannot spoof the actor', async () => {
    const old = await credentials();
    await reset(user.userId, { temporaryPassword: TEMPORARY_PASSWORD, adminId: user.userId }).expect(400);
    await reset(user.userId, { temporaryPassword: TEMPORARY_PASSWORD }, user).expect(403);
    await reset(admin.userId).expect(404);
    await reset(new Types.ObjectId().toString()).expect(404);
    await fixture.http().post(`/api/admin/users/${user.userId}/reset-password`).send({ temporaryPassword: TEMPORARY_PASSWORD }).expect(401);
    assert.equal(await collection('auditlogs').countDocuments({}), 0);
    assert.equal((await credentials()).passwordHash, old.passwordHash);
  });

  it('ACC-07a: resetting a suspended moderator preserves suspension and resets lockout without storing secrets', async () => {
    await fixture.users.updateOne({ _id: user.userId }, { $set: { role: UserRole.HOTEL_MODERATOR, status: AccountStatus.SUSPENDED, failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 60_000) } });
    await reset().expect(204);
    const stored = await credentials();
    assert.equal(stored.role, UserRole.HOTEL_MODERATOR);
    assert.equal(stored.status, AccountStatus.SUSPENDED);
    assert.equal(stored.failedLoginAttempts, 0);
    assert.equal(stored.lockedUntil, null);
    assert.equal(await collection('auditlogs').countDocuments({ action: 'PASSWORD_RESET' }), 1);
  });

  for (const operation of ['suspend', 'reactivate'] as const) {
    for (const failureAt of ['audit', 'notification'] as const) {
      it(`ACC-15/16: ${operation} rolls back status, audit and notice after ${failureAt} persistence fails`, async (context) => {
        if (operation === 'reactivate') await change('suspend').expect(200);
        const beforeCounts = await counts();
        const oldStatus = (await credentials()).status;
        const fail = async () => { throw new Error('Injected database write failure after persistence'); };
        const originalAudit = audits.log.bind(audits);
        const originalNotice = notices.notify.bind(notices);
        const failure = failureAt === 'audit'
          ? context.mock.method(audits, 'log', async (...args: Parameters<AuditLogsService['log']>) => { await originalAudit(...args); await fail(); })
          : context.mock.method(notices, 'notify', async (...args: Parameters<NotificationsService['notify']>) => { await originalNotice(...args); await fail(); });
        try {
          await change(operation).expect(500);
          assert.equal((await credentials()).status, oldStatus);
          assert.deepEqual(await counts(), beforeCounts);
          await fixture.http().get('/api/auth/me').set('Cookie', user.cookie).expect(oldStatus === AccountStatus.ACTIVE ? 200 : 401);
        } finally { failure.mock.restore(); }
        await change(operation).expect(200);
        assert.deepEqual(await counts(), { audits: beforeCounts.audits + 1, notifications: beforeCounts.notifications + 1 });
      });
    }
  }

  it('GEN-07: concurrent status changes retain exactly one winning actor, audit and notification', async () => {
    const other = await fixture.login('other-admin@example.com', UserRole.ADMIN);
    const responses = await Promise.all([change('suspend'), change('suspend', other)]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.deepEqual(await counts(), { audits: 1, notifications: 1 });
    const entry = await collection('auditlogs').findOne({});
    assert.equal(entry!.adminId.toString(), responses[0].status === 200 ? admin.userId : other.userId);
  });

  it('ACC-13/GEN-07: a failed moderator audit rolls back both new account and assignment before safe retry', async (context) => {
    const hotelId = (await collection('hotels').insertOne({ name: 'Moderator Hotel', city: 'Cairo', countryCode: 'EG', address: 'Test', isActive: true })).insertedId;
    const body = { name: 'Hotel Desk', email: 'desk@example.com', role: 'HOTEL_MODERATOR', providerId: hotelId.toString(), temporaryPassword: TEMPORARY_PASSWORD };
    const create = () => fixture.http().post('/api/admin/moderators').set('Cookie', admin.cookie).send(body);
    const original = audits.log.bind(audits);
    const failure = context.mock.method(audits, 'log', async (...args: Parameters<AuditLogsService['log']>) => { await original(...args); throw new Error('Injected audit failure'); });
    try {
      await create().expect(500);
      assert.equal(await fixture.users.countDocuments({ email: body.email }), 0);
      assert.equal(await collection('moderatorassignments').countDocuments({}), 0);
      assert.equal(await collection('auditlogs').countDocuments({}), 0);
    } finally { failure.mock.restore(); }
    await create().expect(201);
    assert.equal(await fixture.users.countDocuments({ email: body.email }), 1);
    assert.equal(await collection('moderatorassignments').countDocuments({}), 1);
    assert.equal(await collection('auditlogs').countDocuments({ action: 'MODERATOR_CREATED' }), 1);
  });

  for (const failureAt of ['audit', 'notification'] as const) {
    it(`ACC-15: provider ${failureAt} failure rolls status and all stored notices back`, async (context) => {
      const hotelId = (await collection('hotels').insertOne({ name: 'Provider Hotel', city: 'Cairo', countryCode: 'EG', address: 'Test', isActive: true })).insertedId;
      await collection('moderatorassignments').insertOne({ moderatorId: new Types.ObjectId(user.userId), hotelId });
      const call = () => fixture.http().patch(`/api/admin/providers/hotel/${hotelId}/deactivate`).set('Cookie', admin.cookie).send({});
      const originalAudit = audits.log.bind(audits);
      const originalNotice = notices.notifyMany.bind(notices);
      const failure = failureAt === 'audit'
        ? context.mock.method(audits, 'log', async (...args: Parameters<AuditLogsService['log']>) => { await originalAudit(...args); throw new Error('Injected audit failure'); })
        : context.mock.method(notices, 'notifyMany', async (...args: Parameters<NotificationsService['notifyMany']>) => { await originalNotice(...args); throw new Error('Injected notice failure'); });
      try {
        await call().expect(500);
        assert.equal((await collection('hotels').findOne({ _id: hotelId }))!.isActive, true);
        assert.deepEqual(await counts(), { audits: 0, notifications: 0 });
      } finally { failure.mock.restore(); }
      await call().expect(200);
      assert.equal((await collection('hotels').findOne({ _id: hotelId }))!.isActive, false);
      assert.deepEqual(await counts(), { audits: 1, notifications: 1 });
    });
  }

  it('ACC-15: hotel deactivation releases pending room holds but retains existing confirmed reservations', async () => {
    const hotels = fixture.app.get<Model<Hotel>>(getModelToken(Hotel.name));
    const rooms = fixture.app.get<Model<Room>>(getModelToken(Room.name));
    const hotel = await hotels.create({ name: 'Held Hotel', city: 'Cairo', countryCode: 'EG', address: 'Test' });
    const room = await rooms.create({ hotelId: hotel._id, name: 'Room', capacity: 2, pricePerNight: 10000 });
    await configureTestBookableRoom(fixture.connection,room._id,hotel._id);
    const hold = await fixture.http().post('/api/hotel-bookings').set('Cookie', user.cookie).send({ hotelId: hotel._id.toString(), checkIn: '2027-12-20', checkOut: '2027-12-22', rooms: [{ roomId: room._id.toString(), adults: 1, childrenAges: [] }] }).expect(201);
    const confirmedId = (await collection('hotelbookings').insertOne({ hotelId: hotel._id, userId: new Types.ObjectId(user.userId), status: 'CONFIRMED', rooms: [] })).insertedId;
    await fixture.http().patch(`/api/admin/providers/hotel/${hotel._id}/deactivate`).set('Cookie', admin.cookie).send({}).expect(200);
    assert.equal((await collection('hotelbookings').findOne({ _id: new Types.ObjectId(hold.body.hotelBookingId) }))!.status, 'EXPIRED');
    assert.equal((await collection('hotelbookings').findOne({ _id: confirmedId }))!.status, 'CONFIRMED');
    const availability = await collection('roomavailabilities').findOne({ roomId: room._id });
    assert.equal(availability!.bookedRanges.length, 0);
    assert.equal(await fixture.app.get(HotelBookingsService).releasePendingHoldsForHotel(hotel._id.toString()), 0);
  });

  it('documents the reset audit and rollback errors in Swagger', async () => {
    const document = (await fixture.http().get('/api/docs-json').expect(200)).body;
    const resetOperation = document.paths['/api/admin/users/{userId}/reset-password'].post;
    assert.match(resetOperation.description, /PASSWORD_RESET/);
    assert.ok(resetOperation.responses['500']);
    assert.ok(document.paths['/api/admin/accounts/{id}/suspend'].patch.responses['500']);
    assert.ok(document.paths['/api/admin/providers/{type}/{id}/deactivate'].patch.responses['500']);
  });
});
