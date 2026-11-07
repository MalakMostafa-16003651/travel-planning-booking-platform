import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { UserRole } from '../src/common/enums/user-role.enum';
import { NotificationType } from '../src/notifications/notification-type.enum';
import { NotificationsModule } from '../src/notifications/notifications.module';
import { NotificationsService } from '../src/notifications/notifications.service';
import { AdminFixture, Session } from './admin-fixture';

describe('GEN-01 in-app notifications', { concurrency: false }, () => {
  const fixture = new AdminFixture([NotificationsModule]);
  let alice: Session;
  let bob: Session;
  let service: NotificationsService;

  const get = (session: Session, path = '') => fixture.http().get(`/api/notifications${path}`).set('Cookie', session.cookie);
  const patch = (session: Session, path: string) => fixture.http().patch(`/api/notifications${path}`).set('Cookie', session.cookie);

  before(async () => {
    await fixture.start('notifications');
    service = fixture.app.get(NotificationsService);
  }, { timeout: 30 * 60_000 });
  after(() => fixture.stop());

  beforeEach(async () => {
    await fixture.reset();
    alice = await fixture.login('alice@example.com', UserRole.USER, 'Alice');
    bob = await fixture.login('bob@example.com', UserRole.USER, 'Bob');
  });

  it('GEN-01: another module notifies a user, who sees it in their inbox', async () => {
    await service.notify({ userId: alice.userId, type: NotificationType.BOOKING_CONFIRMED, message: 'Your flight booking ABC123 is confirmed.' });

    const response = await get(alice).expect(200);
    assert.equal(response.body.total, 1);
    assert.equal(response.body.unreadCount, 1);
    assert.equal(response.body.pageSize, 10);
    const [notification] = response.body.items;
    assert.equal(notification.type, 'BOOKING_CONFIRMED');
    assert.equal(notification.message, 'Your flight booking ABC123 is confirmed.');
    assert.equal(notification.isRead, false);
    assert.equal(notification.readAt, null);
    assert.ok(notification.notificationId);
    assert.equal(response.headers['cache-control'], 'no-store');
  });

  it("GEN-01: accepts Person 4's BookingNotificationsPort shape unchanged", async () => {
    // The flight-bookings port sends plain string types; the service must accept them as they are.
    const fromPort: { userId: string; type: 'BOOKING_CONFIRMED' | 'BOOKING_CANCELLED'; message: string } =
      { userId: alice.userId, type: 'BOOKING_CANCELLED', message: 'Your booking was cancelled.' };
    await service.notify(fromPort);
    assert.equal((await get(alice).expect(200)).body.items[0].type, 'BOOKING_CANCELLED');
  });

  it('GEN-01/ACC-11: users only ever see and change their own notifications', async () => {
    await service.notify({ userId: alice.userId, type: NotificationType.REFUND_ISSUED, message: 'Refund issued.' });
    const aliceId = (await get(alice).expect(200)).body.items[0].notificationId;

    assert.equal((await get(bob).expect(200)).body.total, 0);
    assert.equal((await get(bob, '/unread-count').expect(200)).body.unreadCount, 0);
    await patch(bob, `/${aliceId}/read`).expect(404);
    assert.equal((await patch(bob, '/read-all').expect(200)).body.updatedCount, 0);
    assert.equal((await get(alice, '/unread-count').expect(200)).body.unreadCount, 1);
    // A query identifier cannot select another inbox.
    assert.equal((await get(bob, `?userId=${alice.userId}`).expect(400)).body.message, 'Validation failed');
  });

  it('GEN-01: marks one as read once, keeping the first read time', async () => {
    await service.notify({ userId: alice.userId, type: NotificationType.ACCOUNT_REACTIVATED, message: 'Your account is active again.' });
    const id = (await get(alice).expect(200)).body.items[0].notificationId;

    const first = await patch(alice, `/${id}/read`).expect(200);
    assert.equal(first.body.isRead, true);
    assert.ok(first.body.readAt);
    const again = await patch(alice, `/${id}/read`).expect(200);
    assert.equal(again.body.readAt, first.body.readAt);
    assert.equal((await get(alice, '/unread-count').expect(200)).body.unreadCount, 0);
  });

  it('GEN-01: marks all as read and filters unread only', async () => {
    await service.notifyMany([alice.userId], NotificationType.FLIGHT_SCHEDULE_CHANGED, 'Flight MS123 now departs at 10:30.');
    await service.notify({ userId: alice.userId, type: NotificationType.BOOKING_CANCELLED, message: 'Cancelled.' });
    await service.notify({ userId: alice.userId, type: NotificationType.REFUND_ISSUED, message: 'Refunded.' });
    const firstId = (await get(alice).expect(200)).body.items[0].notificationId;
    await patch(alice, `/${firstId}/read`).expect(200);

    const unread = await get(alice, '?unreadOnly=true').expect(200);
    assert.equal(unread.body.total, 2);
    assert.equal(unread.body.unreadCount, 2);
    assert.equal(unread.body.items.every((item: { isRead: boolean }) => !item.isRead), true);

    assert.equal((await patch(alice, '/read-all').expect(200)).body.updatedCount, 2);
    assert.equal((await get(alice, '/unread-count').expect(200)).body.unreadCount, 0);
    assert.equal((await get(alice, '?unreadOnly=true').expect(200)).body.total, 0);
    assert.equal((await get(alice).expect(200)).body.total, 3);
  });

  it('GEN-01/GEN-05: lists newest first, 10 per page', async () => {
    for (let index = 0; index < 12; index += 1) {
      await service.notify({ userId: alice.userId, type: NotificationType.BOOKING_CONFIRMED, message: `message ${index}` });
    }
    const first = await get(alice).expect(200);
    assert.equal(first.body.items.length, 10);
    assert.equal(first.body.items[0].message, 'message 11');
    const second = await get(alice, '?page=2').expect(200);
    assert.deepEqual(second.body.items.map((item: { message: string }) => item.message), ['message 1', 'message 0']);
  });

  it('ACC-15: notifies several users at once, once each', async () => {
    await service.notifyMany([alice.userId, bob.userId, alice.userId.toUpperCase()], NotificationType.PROVIDER_DEACTIVATED, 'Nile Air has been deactivated. Your confirmed booking remains valid.');
    assert.equal((await get(alice).expect(200)).body.total, 1);
    assert.equal((await get(bob).expect(200)).body.total, 1);
  });

  it('GEN-01: every logged-in role has an inbox; guests do not', async () => {
    await fixture.http().get('/api/notifications').expect(401);
    await fixture.http().get('/api/notifications/unread-count').expect(401);
    await fixture.http().patch('/api/notifications/read-all').expect(401);
    for (const [email, role] of [['admin@example.com', UserRole.ADMIN], ['air@example.com', UserRole.AIRLINE_MODERATOR], ['hotel@example.com', UserRole.HOTEL_MODERATOR]] as const) {
      const session = await fixture.login(email, role);
      await service.notify({ userId: session.userId, type: NotificationType.ACCOUNT_SUSPENDED, message: 'Test.' });
      assert.equal((await get(session).expect(200)).body.total, 1);
    }
  });

  it('GEN-01/GEN-13: rejects invalid input and stores nothing', async () => {
    await get(alice, '?page=0').expect(400);
    await get(alice, '?unreadOnly=maybe').expect(400);
    await patch(alice, '/not-an-id/read').expect(400);
    await patch(alice, `/${new Types.ObjectId().toString()}/read`).expect(404);
    await assert.rejects(service.notify({ userId: 'nope', type: NotificationType.BOOKING_CONFIRMED, message: 'x' }));
    await assert.rejects(service.notify({ userId: alice.userId, type: 'PARTY' as NotificationType, message: 'x' }));
    assert.equal(await fixture.connection.collection('notifications').countDocuments(), 0);
  });

  it('lists every endpoint in Swagger with GEN-01', async () => {
    const document = (await fixture.http().get('/api/docs-json').expect(200)).body;
    const operations: [string, string][] = [
      ['/api/notifications', 'get'],
      ['/api/notifications/unread-count', 'get'],
      ['/api/notifications/read-all', 'patch'],
      ['/api/notifications/{id}/read', 'patch'],
    ];
    for (const [path, method] of operations) assert.match(document.paths[path][method].summary, /^GEN-01/, `${method} ${path}`);
  });
});
