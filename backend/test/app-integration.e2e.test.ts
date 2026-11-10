import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it, mock } from 'node:test';
import { Injectable, INestApplication, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request, { Response } from 'supertest';
import { AuditAction, AuditTargetType } from '../src/audit-logs/audit-log.enums';
import { AuditLogsService } from '../src/audit-logs/audit-logs.service';
import { AuthModule } from '../src/auth/auth.module';
import { PasswordService } from '../src/auth/password.service';
import { AccountStatus } from '../src/common/enums/account-status.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { configureApplication } from '../src/configure-application';
import { NotificationsService } from '../src/notifications/notifications.service';

// A consuming module must inject the shared hasher through AuthModule's public
// exports, rather than registering a second implementation or provider.
@Injectable()
class ModeratorPasswordConsumer {
  constructor(readonly passwords: PasswordService) {}
}

@Module({ imports: [AuthModule], providers: [ModeratorPasswordConsumer] })
class AdminConsumerModule {}

function cookies(response: Response): string {
  return (response.headers['set-cookie'] as unknown as string[])
    .map((cookie) => cookie.split(';')[0]).join('; ');
}

describe('merged production module integration', { concurrency: false }, () => {
  let app: INestApplication;
  let replicaSet: MongoMemoryReplSet;
  let connection: Connection;
  let admin: { userId: string; cookie: string };
  let user: { userId: string; cookie: string };
  const previousEnvironment = new Map<string, string | undefined>();

  async function login(email: string, role: UserRole) {
    await request(app.getHttpServer()).post('/api/auth/register').send({
      name: 'Integration User', email, password: 'Travel123', termsAccepted: true,
    }).expect(201);
    await connection.collection('users').updateOne({ email }, { $set: { role } });
    const response = await request(app.getHttpServer()).post('/api/auth/login')
      .set('Sec-Fetch-Site', 'same-origin').send({ email, password: 'Travel123' }).expect(200);
    return { userId: response.body.userId as string, cookie: cookies(response) };
  }

  before(async () => {
    replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    const environment = {
      MONGODB_URI: replicaSet.getUri('merged-app-integration'),
      JWT_SECRET: randomBytes(48).toString('hex'),
      PORT: '3000', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', FXRATES_API_KEY: '',
      SMTP_HOST: '', SMTP_PORT: '', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '', PASSWORD_RESET_URL: '', EMAIL_VERIFICATION_URL: '', EMAIL_VERIFICATION_REQUIRED: 'false',
    };
    for (const [key, value] of Object.entries(environment)) {
      previousEnvironment.set(key, process.env[key]);
      process.env[key] = value;
    }
    // Use the actual root module and its validation/production provider bindings,
    // but prevent its ConfigModule from reading anyone's private .env file.
    const original = ConfigModule.forRoot.bind(ConfigModule);
    const config = mock.method(ConfigModule, 'forRoot', (options?: Parameters<typeof ConfigModule.forRoot>[0]) =>
      original({ ...options, ignoreEnvFile: true }));
    let rootModule;
    try {
      rootModule = (await import('../src/app.module')).AppModule;
    } finally {
      config.mock.restore();
    }
    const testing = await Test.createTestingModule({ imports: [rootModule, AdminConsumerModule] }).compile();
    app = testing.createNestApplication({ rawBody: true });
    configureApplication(app);
    await app.init();
    connection = testing.get(getConnectionToken());
    await Promise.all(Object.values(connection.models).map((model) => model.init()));
    admin = await login('root-admin@example.com', UserRole.ADMIN);
    user = await login('root-user@example.com', UserRole.USER);
  }, { timeout: 120_000 });

  after(async () => {
    await app?.close();
    await replicaSet?.stop();
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('starts the real module graph and exposes every merged domain in Swagger', async () => {
    const document = (await request(app.getHttpServer()).get('/api/docs-json').expect(200)).body;
    for (const path of ['/api/auth/login', '/api/auth/forgot-password', '/api/auth/reset-password', '/api/users/me', '/api/admin/audit-logs', '/api/payments',
      '/api/payments/webhook', '/api/refunds/{id}', '/api/posts', '/api/itineraries',
      '/api/favorites', '/api/flight-bookings/hold', '/api/flights/search', '/api/hotels/search', '/api/currencies', '/api/countries']) {
      assert.ok(document.paths[path], `Missing production route ${path}`);
    }
    assert.equal(document.paths['/api/admin/audit-logs'].post, undefined);
    assert.ok(document.paths['/api/payments/webhook'].post);
  });

  it('connects standalone favorites to real root auth, hotel reads and owner-only removal', async () => {
    const hotelId = new Types.ObjectId();
    await connection.collection('hotels').insertOne({ _id: hotelId, name: 'Root favorite hotel', city: 'Cairo', countryCode: 'EG', isActive: true });
    const server = app.getHttpServer();
    await request(server).get('/api/favorites').expect(401);
    const saved = await request(server).post('/api/favorites').set('Cookie', user.cookie).send({ hotelId: hotelId.toString() }).expect(201);
    assert.equal(saved.body.hotel.name, 'Root favorite hotel');
    const page = await request(server).get('/api/favorites').set('Cookie', user.cookie).expect(200);
    assert.equal(page.body.total, 1); assert.equal(page.body.items[0].userId, user.userId);
    await request(server).delete('/api/favorites/' + saved.body.favoriteId).set('Cookie', admin.cookie).expect(403);
    await request(server).delete('/api/favorites/' + saved.body.favoriteId).set('Cookie', user.cookie).expect(204);
    assert.ok(await connection.collection('hotels').findOne({ _id: hotelId }));
  });

  it('keeps optional password recovery disabled uniformly in the real module graph', async () => {
    const server = app.getHttpServer();
    const known = await request(server).post('/api/auth/forgot-password').send({ email: 'root-user@example.com' }).expect(503);
    const unknown = await request(server).post('/api/auth/forgot-password').send({ email: 'unknown@example.com' }).expect(503);
    assert.deepEqual(known.body, unknown.body);
    assert.equal(await connection.collection('passwordresets').countDocuments({}), 0);
  });

  it('lets an importing admin module use the same shared password hasher', async () => {
    const hasher = app.get(ModeratorPasswordConsumer).passwords;
    assert.equal(hasher, app.get(PasswordService));
    const hash = await hasher.hash('Travel123');
    assert.equal(await hasher.verify('Travel123', hash), true);
    assert.equal(await hasher.verify('Wrong123', hash), false);
  });

  it('persists audit records and protects their HTTP list using the real auth guards', async () => {
    await app.get(AuditLogsService).log({
      adminId: admin.userId, action: AuditAction.CONTENT_HIDDEN,
      targetType: AuditTargetType.POST, targetId: new Types.ObjectId().toString(),
    });
    const server = app.getHttpServer();
    await request(server).get('/api/admin/audit-logs').expect(401);
    await request(server).get('/api/admin/audit-logs').set('Cookie', user.cookie).expect(403);
    const result = await request(server).get('/api/admin/audit-logs').set('Cookie', admin.cookie).expect(200);
    assert.equal(result.body.total, 1);
    assert.equal(result.body.items[0].action, AuditAction.CONTENT_HIDDEN);
    assert.equal(result.body.items[0].adminName, 'Integration User');
    assert.equal(result.headers['cache-control'], 'no-store');
  });

  it('rejects invalid audit dates through the actual root application', async () => {
    const result = await request(app.getHttpServer()).get('/api/admin/audit-logs?from=2026-W45')
      .set('Cookie', admin.cookie).expect(400);
    assert.ok(result.body.errors.from);
  });

  it('rejects an existing admin session immediately after the account is suspended', async () => {
    await connection.collection('users').updateOne({ _id: new Types.ObjectId(admin.userId) },
      { $set: { status: AccountStatus.SUSPENDED } });
    try {
      await request(app.getHttpServer()).get('/api/admin/audit-logs').set('Cookie', admin.cookie).expect(401);
    } finally {
      await connection.collection('users').updateOne({ _id: new Types.ObjectId(admin.userId) },
        { $set: { status: AccountStatus.ACTIVE } });
    }
  });

  it('connects notifications to actual root authentication and ownership', async () => {
    const other = await login('notification-other@example.com', UserRole.USER);
    await app.get(NotificationsService).notify({ userId: user.userId, type: 'BOOKING_CONFIRMED', message: 'Integration booking confirmed.' });
    const server = app.getHttpServer();
    await request(server).get('/api/notifications').expect(401);
    const inbox = await request(server).get('/api/notifications').set('Cookie', user.cookie).expect(200);
    assert.equal(inbox.body.total, 1);
    const id = inbox.body.items[0].notificationId;
    const otherInbox = await request(server).get('/api/notifications').set('Cookie', other.cookie).expect(200);
    assert.equal(otherInbox.body.total, 0);
    await request(server).patch('/api/notifications/' + id + '/read').set('Cookie', other.cookie).expect(404);
    await request(server).patch('/api/notifications/read-all').set('Cookie', user.cookie).set('Origin', 'https://untrusted.example').expect(403);
    const unread = await request(server).get('/api/notifications/unread-count').set('Cookie', user.cookie).expect(200);
    assert.equal(unread.body.unreadCount, 1);
    const read = await request(server).patch('/api/notifications/' + id + '/read').set('Cookie', user.cookie).expect(200);
    assert.equal(read.body.isRead, true);
  });

  it('composes payment authentication and raw-body webhook validation without Stripe credentials', async () => {
    const server = app.getHttpServer();
    await request(server).post('/api/payments').send({}).expect(401);
    await request(server).post('/api/payments/webhook').send({ type: 'payment_intent.succeeded' }).expect(400);
    await request(server).get(`/api/payments/${new Types.ObjectId()}`).set('Cookie', user.cookie).expect(404);
  });
});
