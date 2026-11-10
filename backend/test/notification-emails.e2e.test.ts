import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AdminModule } from '../src/admin/admin.module';
import { UserRole } from '../src/common/enums/user-role.enum';
import { MailService } from '../src/mail/mail.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { NotificationEmailOutboxService, NOTIFICATION_EMAIL_MAX_ATTEMPTS } from '../src/notifications/notification-email-outbox.service';
import { NotificationEmailWorkerService } from '../src/notifications/notification-email-worker.service';
import { NotificationType } from '../src/notifications/notification-type.enum';
import { Notification } from '../src/notifications/schemas/notification.schema';
import { NotificationEmailStatus } from '../src/notifications/schemas/notification-email-job.schema';
import { AdminFixture, Session } from './admin-fixture';

type Message = { to: string; subject: string; text: string };
const TEMPORARY_PASSWORD = 'Invitation123';

describe('GEN-01-B durable notification emails and moderator invitations', { concurrency: false }, () => {
  const fixture = new AdminFixture([AdminModule]);
  let admin: Session;
  let alice: Session;
  let outbox: NotificationEmailOutboxService;
  let notifications: NotificationsService;
  let mail: MailService;
  let configured = true;
  let failures = 0;
  let attempts: Message[] = [];
  let delivered: Message[] = [];
  let restoreMail: () => void;
  const jobs = () => fixture.connection.collection('notificationemailjobs');
  const inbox = () => fixture.connection.collection('notifications');
  const notice = (message = 'Your booking is confirmed') => notifications.notify({
    userId: alice.userId, type: NotificationType.BOOKING_CONFIRMED, message,
  });
  const makeDue = () => jobs().updateMany({ status: NotificationEmailStatus.PENDING }, { $set: { availableAt: new Date(0) } });

  before(async () => {
    await fixture.start('notification-email-outbox');
    // Stop only the poller; tests invoke the real durable dispatcher explicitly.
    await fixture.app.get(NotificationEmailWorkerService).onModuleDestroy();
    outbox = fixture.app.get(NotificationEmailOutboxService);
    notifications = fixture.app.get(NotificationsService);
    mail = fixture.app.get(MailService);
    const readiness = mock.method(mail, 'isConfigured', () => configured);
    const sender = mock.method(mail, 'send', async (message: Message) => {
      attempts.push(message);
      if (failures > 0) { failures--; throw new Error('Injected SMTP failure with synthetic private diagnostics'); }
      delivered.push(message);
    });
    restoreMail = () => { readiness.mock.restore(); sender.mock.restore(); };
  }, { timeout: 120_000 });
  beforeEach(async () => {
    await fixture.reset();
    configured = true; failures = 0; attempts = []; delivered = [];
    admin = await fixture.login('email-admin@example.com', UserRole.ADMIN);
    alice = await fixture.login('email-user@example.com');
  });
  after(async () => { await fixture.stop(); restoreMail?.(); });

  it('queues every existing GEN-01 type and sends plain text to the current account email', async () => {
    for (const type of Object.values(NotificationType)) await notifications.notify({ userId: alice.userId, type, message: 'Event ' + type });
    assert.equal(delivered.length, 0);
    assert.equal(await inbox().countDocuments({}), 8);
    assert.equal(await jobs().countDocuments({}), 8);
    assert.equal(await outbox.processBatch(), 8);
    assert.equal(delivered.length, 8);
    assert.ok(delivered.every((message) => message.to === 'email-user@example.com' && message.subject.startsWith('Travel Planning: ') && message.text.includes('Event ')));
    assert.equal(await jobs().countDocuments({ status: NotificationEmailStatus.SENT }), 8);
    assert.equal(await outbox.processBatch(), 0);
  });

  it('can deliver a single paced job while leaving the next committed job pending', async () => {
    await notice('First paced message'); await notice('Second paced message');
    assert.equal(await outbox.processBatch(1), 1);
    assert.equal(delivered.length, 1);
    assert.equal(await jobs().countDocuments({ status: NotificationEmailStatus.PENDING }), 1);
    assert.equal(await outbox.processBatch(1), 1);
    assert.equal(delivered.length, 2);
  });

  it('deduplicates multi-recipient IDs and does not enqueue or send a notification twice', async () => {
    await notifications.notifyMany([alice.userId, admin.userId, alice.userId.toUpperCase()], NotificationType.PROVIDER_DEACTIVATED, 'Provider deactivated');
    const rows = await fixture.app.get<Model<Notification>>(getModelToken(Notification.name)).find().exec();
    await fixture.connection.transaction(async (session) => { await outbox.enqueueNotifications(rows, session); });
    assert.equal(await jobs().countDocuments({}), 2);
    await outbox.processBatch();
    await fixture.connection.transaction(async (session) => { await outbox.enqueueNotifications(rows, session); });
    assert.equal(await outbox.processBatch(), 0);
    assert.equal(delivered.length, 2);
    assert.equal(await jobs().countDocuments({ status: NotificationEmailStatus.SENT }), 2);
  });

  it('cannot send before a caller transaction commits and discards an aborted notification/job', async () => {
    const session = await fixture.connection.startSession();
    try {
      session.startTransaction();
      await notifications.notify({ userId: alice.userId, type: NotificationType.REFUND_ISSUED, message: 'Refund event' }, session);
      assert.equal(await outbox.processBatch(), 0);
      assert.equal(attempts.length, 0);
      await session.abortTransaction();
      assert.equal(await inbox().countDocuments({}), 0);
      assert.equal(await jobs().countDocuments({}), 0);
    } finally { await session.endSession(); }
  });

  it('rolls an in-app notification back if its outbox insert fails, including after insertion', async (context) => {
    const original = outbox.enqueueNotifications.bind(outbox);
    const failing = context.mock.method(outbox, 'enqueueNotifications', async (...args: Parameters<NotificationEmailOutboxService['enqueueNotifications']>) => {
      await original(...args); throw new Error('Injected queue persistence failure');
    });
    try { await assert.rejects(notice()); } finally { failing.mock.restore(); }
    assert.equal(await inbox().countDocuments({}), 0);
    assert.equal(await jobs().countDocuments({}), 0);
    assert.equal(await outbox.processBatch(), 0);
    await notice(); await outbox.processBatch();
    assert.equal(delivered.length, 1);
  });

  it('leaves jobs pending without SMTP and resumes without disturbing the inbox', async () => {
    configured = false;
    await notice();
    assert.equal(await outbox.processBatch(), 0);
    const job = await jobs().findOne({});
    assert.equal(job!.status, NotificationEmailStatus.PENDING);
    assert.equal(job!.attempts, 0);
    const response = await fixture.http().get('/api/notifications').set('Cookie', alice.cookie).expect(200);
    assert.equal(response.body.total, 1);
    assert.ok(!JSON.stringify(response.body).includes('leaseToken'));
    configured = true;
    await outbox.processBatch();
    assert.equal(delivered.length, 1);
    assert.equal(await inbox().countDocuments({}), 1);
  });

  it('persists SMTP failure/backoff and retries without another in-app notification', async () => {
    failures = 1; await notice();
    await outbox.processBatch();
    const failed = await jobs().findOne({});
    assert.equal(failed!.status, NotificationEmailStatus.PENDING);
    assert.equal(failed!.attempts, 1);
    assert.ok(failed!.availableAt.getTime() > Date.now());
    assert.ok(!JSON.stringify(failed).includes('synthetic private diagnostics'));
    assert.equal(await outbox.processBatch(), 0);
    await makeDue(); await outbox.processBatch();
    const sent = await jobs().findOne({});
    assert.equal(sent!.status, NotificationEmailStatus.SENT);
    assert.equal(sent!.attempts, 2);
    assert.ok(sent!.sentAt instanceof Date);
    assert.equal(attempts.length, 2); assert.equal(delivered.length, 1);
    assert.equal(await inbox().countDocuments({}), 1);
  });

  it('stops automatic retries after five failures and keeps the notification available', async () => {
    failures = 20; await notice();
    for (let i = 0; i < NOTIFICATION_EMAIL_MAX_ATTEMPTS; i++) { await makeDue(); await outbox.processBatch(); }
    const failed = await jobs().findOne({});
    assert.equal(failed!.status, NotificationEmailStatus.FAILED);
    assert.equal(failed!.attempts, 5);
    await makeDue(); assert.equal(await outbox.processBatch(), 0);
    assert.equal(attempts.length, 5);
    assert.equal(await inbox().countDocuments({}), 1);
  });

  it('recovers an expired lease and terminates an exhausted abandoned lease', async () => {
    await notice('Recover lease'); await notice('Exhausted lease');
    await jobs().updateOne({ message: 'Recover lease' }, { $set: { status: NotificationEmailStatus.PROCESSING, attempts: 1, leaseToken: 'old', leaseUntil: new Date(0) } });
    await jobs().updateOne({ message: 'Exhausted lease' }, { $set: { status: NotificationEmailStatus.PROCESSING, attempts: 5, leaseToken: 'old-final', leaseUntil: new Date(0) } });
    assert.equal(await outbox.processBatch(), 1);
    assert.equal((await jobs().findOne({ message: 'Recover lease' }))!.attempts, 2);
    assert.equal((await jobs().findOne({ message: 'Exhausted lease' }))!.status, NotificationEmailStatus.FAILED);
    assert.equal(delivered.length, 1);
  });

  it('allows only one worker to deliver a normally leased job', async (context) => {
    await notice();
    let started!: () => void; let release!: () => void;
    const inSend = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const sender = context.mock.method(mail, 'send', async (message: Message) => {
      attempts.push(message); started(); await gate; delivered.push(message);
    });
    const first = outbox.processBatch();
    await inSend;
    try { assert.equal(await outbox.processBatch(), 0); } finally { release(); }
    await first; sender.mock.restore();
    assert.equal(delivered.length, 1);
    assert.equal(await jobs().countDocuments({ status: NotificationEmailStatus.SENT }), 1);
  });

  it('does not redirect a deleted account notification to another recipient', async () => {
    await notice(); await fixture.users.deleteOne({ _id: new Types.ObjectId(alice.userId) });
    await outbox.processBatch();
    assert.equal(attempts.length, 0);
    assert.equal((await jobs().findOne({}))!.status, NotificationEmailStatus.FAILED);
  });

  it('still emails suspension notices to a suspended account', async () => {
    await fixture.users.updateOne({ _id: new Types.ObjectId(alice.userId) }, { $set: { status: 'SUSPENDED' } });
    await notifications.notify({ userId: alice.userId, type: NotificationType.ACCOUNT_SUSPENDED, message: 'Your account is suspended' });
    await outbox.processBatch();
    assert.equal(delivered.length, 1);
    assert.match(delivered[0].subject, /Account suspended/);
  });

  async function moderator(role: UserRole.AIRLINE_MODERATOR | UserRole.HOTEL_MODERATOR) {
    const airline = role === UserRole.AIRLINE_MODERATOR;
    const providerId = (await fixture.connection.collection(airline ? 'airlines' : 'hotels').insertOne({
      name: 'Invitation provider', code: 'ZX', city: 'Cairo', countryCode: 'EG', address: 'Test', isActive: true,
    })).insertedId.toString();
    return { name: 'New Moderator', email: 'invited@example.com', role, providerId, temporaryPassword: TEMPORARY_PASSWORD };
  }
  const createModerator = (body: object) => fixture.http().post('/api/admin/moderators').set('Cookie', admin.cookie).send(body);

  for (const role of [UserRole.AIRLINE_MODERATOR, UserRole.HOTEL_MODERATOR] as const) {
    it('invites ' + role + ' after account/assignment/audit commit without emailing a password', async () => {
      const body = await moderator(role);
      await createModerator(body).expect(201);
      assert.equal(delivered.length, 0);
      assert.equal(await jobs().countDocuments({ kind: 'MODERATOR_INVITATION' }), 1);
      await outbox.processBatch();
      assert.equal(delivered.length, 1);
      assert.equal(delivered[0].to, body.email);
      assert.match(delivered[0].subject, /Moderator invitation/);
      assert.match(delivered[0].text, /provided separately/);
      assert.ok(!JSON.stringify(delivered).includes(TEMPORARY_PASSWORD));
      assert.ok(!JSON.stringify(await jobs().find().toArray()).includes(TEMPORARY_PASSWORD));
      assert.equal(await fixture.connection.collection('moderatorassignments').countDocuments({}), 1);
      assert.equal(await fixture.connection.collection('auditlogs').countDocuments({ action: 'MODERATOR_CREATED' }), 1);
      await createModerator(body).expect(409);
      assert.equal(await jobs().countDocuments({}), 1);
    });
  }

  it('rolls moderator, assignment, audit and invitation back if invitation enqueue fails after insert', async (context) => {
    const body = await moderator(UserRole.HOTEL_MODERATOR);
    const original = outbox.enqueueModeratorInvitation.bind(outbox);
    const failure = context.mock.method(outbox, 'enqueueModeratorInvitation', async (...args: Parameters<NotificationEmailOutboxService['enqueueModeratorInvitation']>) => {
      await original(...args); throw new Error('Injected invitation queue failure');
    });
    try { await createModerator(body).expect(500); } finally { failure.mock.restore(); }
    assert.equal(await fixture.users.countDocuments({ email: body.email }), 0);
    for (const name of ['moderatorassignments', 'auditlogs', 'notificationemailjobs']) assert.equal(await fixture.connection.collection(name).countDocuments({}), 0);
    await createModerator(body).expect(201); await outbox.processBatch();
    assert.equal(delivered.length, 1);
  });

  it('does not undo moderator creation on SMTP failure and can deliver the invitation later', async () => {
    const body = await moderator(UserRole.AIRLINE_MODERATOR);
    failures = 1; await createModerator(body).expect(201);
    await outbox.processBatch();
    assert.equal(await fixture.users.countDocuments({ email: body.email }), 1);
    assert.equal(await fixture.connection.collection('moderatorassignments').countDocuments({}), 1);
    assert.equal((await jobs().findOne({}))!.status, NotificationEmailStatus.PENDING);
    await makeDue(); await outbox.processBatch();
    assert.equal(delivered.length, 1);
    assert.equal(await fixture.users.countDocuments({ email: body.email }), 1);
  });

  it('rejects unauthorized invitations and exposes no private outbox HTTP endpoint', async () => {
    const body = await moderator(UserRole.HOTEL_MODERATOR);
    await fixture.http().post('/api/admin/moderators').set('Cookie', alice.cookie).send(body).expect(403);
    await fixture.http().post('/api/admin/moderators').send(body).expect(401);
    assert.equal(await jobs().countDocuments({}), 0);
    await fixture.http().get('/api/notification-email-jobs').set('Cookie', admin.cookie).expect(404);
  });
});
