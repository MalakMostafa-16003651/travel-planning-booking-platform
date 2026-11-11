import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { BOOKING_NOTIFICATIONS } from '../src/flight-bookings/ports/booking-notifications.port';
import { NotificationsService } from '../src/notifications/notifications.service';
import { NotificationEmailWorkerService } from '../src/notifications/notification-email-worker.service';
import { PaymentsFixture } from './payments-fixture';

describe('GEN-01 booking notifications survive inbox persistence failures', () => {
  const fixture = new PaymentsFixture();
  let service: NotificationsService;
  let owner: { userId: string; cookie: string };
  before(async () => {
    await fixture.start('business-notice-recovery', (builder) => builder.overrideProvider(BOOKING_NOTIFICATIONS)
      .useFactory({ factory: (notifications: NotificationsService) => notifications, inject: [NotificationsService] }));
    service = fixture.app.get(NotificationsService);
    await fixture.app.get(NotificationEmailWorkerService).onModuleDestroy();
  }, { timeout: 120_000 });
  after(() => fixture.stop());
  beforeEach(async () => { await fixture.reset(); owner = await fixture.login('notice-owner@example.com'); });

  it('commits confirmation plus its event, then delivers one inbox row and SMTP job after recovery', async () => {
    const bookingId = await fixture.holdBooking(owner.cookie);
    const original = service.notify;
    service.notify = async () => { throw new Error('Inbox write unavailable'); };
    const paymentId = new Types.ObjectId().toString();
    try { await fixture.flightBookings.confirmPaidBooking(bookingId, paymentId); }
    finally { service.notify = original; }
    assert.equal(await fixture.bookingStatus(bookingId), 'CONFIRMED');
    assert.equal(await fixture.connection.collection('notifications').countDocuments(), 0);
    assert.equal(await fixture.connection.collection('notificationevents').countDocuments(), 1);
    await fixture.flightBookings.confirmPaidBooking(bookingId, paymentId);
    await Promise.all([service.processEvents(), service.processEvents()]);
    assert.equal(await fixture.connection.collection('notificationevents').countDocuments(), 0);
    assert.equal(await fixture.connection.collection('notifications').countDocuments(), 1);
    assert.equal(await fixture.connection.collection('notificationemailjobs').countDocuments(), 1);
  });

  it('rolls back confirmation and inventory if the durable event cannot be stored', async () => {
    const bookingId = await fixture.holdBooking(owner.cookie);
    const original = service.stage;
    service.stage = async () => { throw new Error('Event storage unavailable'); };
    try { await assert.rejects(fixture.flightBookings.confirmPaidBooking(bookingId, new Types.ObjectId().toString()), /Event storage unavailable/); }
    finally { service.stage = original; }
    assert.equal(await fixture.bookingStatus(bookingId), 'PENDING');
    const cabin = await fixture.connection.collection('cabininventories').findOne();
    assert.equal(cabin!.heldSeats, 1);
    assert.equal(cabin!.bookedSeats, 0);
    assert.equal(await fixture.connection.collection('notificationevents').countDocuments(), 0);
  });
});
