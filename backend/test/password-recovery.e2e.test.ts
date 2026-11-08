import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request, { Response } from 'supertest';
import { AuthModule } from '../src/auth/auth.module';
import { PASSWORD_RESET_TTL_MS, PasswordRecoveryService } from '../src/auth/password-recovery.service';
import { PasswordManagementService } from '../src/auth/password-management.service';
import { PasswordService } from '../src/auth/password.service';
import { AccountStatus } from '../src/common/enums/account-status.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { configureApplication } from '../src/configure-application';
import { MailService } from '../src/mail/mail.service';
import { User, UserDocument } from '../src/users/schemas/user.schema';
import { UsersService } from '../src/users/users.service';

interface Mail { to: string; subject: string; text: string }
const PASSWORD = 'Travel123', NEW_PASSWORD = 'Replacement456';
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
function cookies(response: Response): string { return ((response.headers['set-cookie'] ?? []) as unknown as string[]).map((cookie) => cookie.split(';')[0]).join('; '); }
function tokenFrom(mail: Mail): string { const match = /https:\/\/client\.example\/reset-password#token=([a-f0-9]{64})/.exec(mail.text); assert.ok(match); return match[1]; }

describe('ACC-07 emailed forgotten-password recovery', { concurrency: false }, () => {
  let app: INestApplication, mongo: MongoMemoryReplSet, connection: Connection, users: Model<UserDocument>, recovery: PasswordRecoveryService;
  let configured = true, sendHook: ((message: Mail) => Promise<void>) | undefined;
  const sent: Mail[] = [];
  const mail = {
    assertConfigured() { if (!configured) throw new ServiceUnavailableException('Password recovery is not configured'); },
    async send(message: Mail) { if (sendHook) await sendHook(message); sent.push(message); },
  };
  const http = () => request(app.getHttpServer());
  const records = () => connection.collection('passwordresets');
  async function account(email = 'recover@example.com', role = UserRole.USER) {
    const result = await http().post('/api/auth/register').send({ name: 'Recovery User', email, password: PASSWORD, termsAccepted: true }).expect(201);
    await users.updateOne({ email }, { $set: { role } }).exec();
    const login = await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    return { userId: result.body.userId as string, email, cookie: cookies(login) };
  }
  async function issue(email = 'recover@example.com') {
    const result = await http().post('/api/auth/forgot-password').send({ email }).expect(202);
    await recovery.whenIdle();
    return { result, token: sent.length ? tokenFrom(sent[sent.length - 1]) : undefined };
  }
  const redeem = (token: string, newPassword = NEW_PASSWORD) => http().post('/api/auth/reset-password').send({ token, newPassword });
  before(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    const testing = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, skipProcessEnv: true, load: [() => ({ JWT_SECRET: randomBytes(48).toString('hex'), PASSWORD_RESET_URL: 'https://client.example/reset-password' })] }),
      MongooseModule.forRoot(mongo.getUri('password-recovery')), AuthModule,
    ] }).overrideProvider(MailService).useValue(mail).compile();
    app = testing.createNestApplication(); configureApplication(app); await app.init();
    connection = testing.get(getConnectionToken()); users = testing.get(getModelToken(User.name)); recovery = testing.get(PasswordRecoveryService);
    await Promise.all(Object.values(connection.models).map((model) => model.init()));
  }, { timeout: 120_000 });
  beforeEach(async () => {
    await recovery.whenIdle();
    for (const collection of await connection.db!.collections()) await collection.deleteMany({});
    sent.length = 0; configured = true; sendHook = undefined;
  });
  after(async () => { await recovery?.whenIdle(); await app?.close(); await mongo?.stop(); });

  it('returns the same accepted response for active, unknown, suspended and deactivated emails without changing accounts', async () => {
    const owner = await account();
    for (const [email, status] of [['suspended@example.com', AccountStatus.SUSPENDED], ['deactivated@example.com', AccountStatus.DEACTIVATED]] as const) {
      await account(email); await users.updateOne({ email }, { $set: { status } });
    }
    const before = await connection.collection('users').find({}).sort({ email: 1 }).toArray();
    const bodies: unknown[] = [];
    for (const email of [' RECOVER@EXAMPLE.COM ', 'unknown@example.com', 'suspended@example.com', 'deactivated@example.com']) {
      const result = (await issue(email)).result; bodies.push(result.body);
      assert.equal(result.headers['cache-control'], 'no-store'); assert.equal(result.headers['set-cookie'], undefined);
    }
    assert.ok(bodies.every((body) => JSON.stringify(body) === JSON.stringify(bodies[0])));
    assert.deepEqual(sent.map((item) => item.to), [owner.email]);
    assert.deepEqual(await connection.collection('users').find({}).sort({ email: 1 }).toArray(), before);
  });
  it('performs account lookup/delivery after acceptance rather than delaying only existing accounts', async () => {
    await account(); const gate = deferred(), started = deferred(); const service = app.get(UsersService), original = service.findForAuthentication.bind(service);
    const lookup = mock.method(service, 'findForAuthentication', async (email: string) => { started.resolve(); await gate.promise; return original(email); });
    try {
      const accepted = await http().post('/api/auth/forgot-password').send({ email: 'recover@example.com' }).expect(202);
      await started.promise; assert.equal(accepted.body.message.includes('If an eligible account'), true); assert.equal(sent.length, 0);
    } finally { gate.resolve(); await recovery.whenIdle(); lookup.mock.restore(); }
    assert.equal(sent.length, 1);
  });
  it('persists only hashed tokens/email keys, sets exactly 30-minute expiry and builds links from trusted config', async () => {
    await account(); const result = await http().post('/api/auth/forgot-password').set('Host', 'attacker.example').send({ email: 'recover@example.com' }).expect(202);
    await recovery.whenIdle(); const token = tokenFrom(sent[0]), row = (await records().findOne({}))!;
    assert.equal(row.tokenHash, createHash('sha256').update(token).digest('hex'));
    assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), PASSWORD_RESET_TTL_MS);
    assert.equal(JSON.stringify(row).includes(token), false); assert.equal(JSON.stringify(row).includes('recover@example.com'), false);
    assert.equal(JSON.stringify(result.body).includes(token), false); assert.equal(sent[0].text.includes('attacker.example'), false);
    const indexes = await records().indexes(); assert.ok(indexes.some((index) => index.expireAfterSeconds === 0));
  });
  for (const role of Object.values(UserRole)) it('resets an active ' + role + ' without changing role/status or automatically logging in', async () => {
    const owner = await account('recover@example.com', role), { token } = await issue();
    const response = await redeem(token!).expect(204);
    assert.equal(response.text, ''); const cleared = response.headers['set-cookie'] as unknown as string[];
    assert.equal(cleared.length, 3); assert.ok(cleared.every((cookie) => cookie.includes('HttpOnly') && cookie.includes('Secure')));
    const row = (await users.findById(owner.userId).select('+credentialVersion +mustChangePassword').exec())!;
    assert.equal(row.role, role); assert.equal(row.status, AccountStatus.ACTIVE); assert.equal(row.credentialVersion, 1); assert.equal(row.mustChangePassword, false);
    await http().get('/api/auth/me').set('Cookie', owner.cookie).expect(401);
    await http().post('/api/auth/login').send({ email: owner.email, password: PASSWORD }).expect(401);
    await http().post('/api/auth/login').send({ email: owner.email, password: NEW_PASSWORD }).expect(200);
    await redeem(token!).expect(400);
  });
  it('invalidates the previous link when a newer request is accepted', async () => {
    await account(); const first = (await issue()).token!, second = (await issue()).token!;
    assert.notEqual(first, second); await redeem(first).expect(400); await redeem(second).expect(204);
  });
  it('rejects an expired link even while its TTL document still exists', async () => {
    await account(); const { token } = await issue(); await records().updateOne({}, { $set: { expiresAt: new Date(0) } });
    const result = await redeem(token!).expect(400); assert.equal(result.body.message, 'Invalid or expired password reset link'); assert.equal(result.headers['set-cookie'], undefined);
    await http().post('/api/auth/login').send({ email: 'recover@example.com', password: PASSWORD }).expect(200);
  });
  it('enforces the existing password policy, rejects spoofed fields and preserves the link after invalid input', async () => {
    await account(); const { token } = await issue();
    for (const newPassword of ['short1', 'abcdefgh', '12345678', PASSWORD]) await redeem(token!, newPassword).expect(400);
    await http().post('/api/auth/reset-password').send({ token, newPassword: NEW_PASSWORD, userId: new Types.ObjectId().toString(), role: 'ADMIN' }).expect(400);
    for (const badToken of ['', 42, 'a'.repeat(63), 'z'.repeat(64)]) await http().post('/api/auth/reset-password').send({ token: badToken, newPassword: NEW_PASSWORD }).expect(400);
    await http().post('/api/auth/forgot-password').send({ email: 'invalid' }).expect(400);
    await http().post('/api/auth/forgot-password').send({ email: 'recover@example.com', userId: 'spoof' }).expect(400);
    await redeem(token!).expect(204);
  });
  it('allows only one concurrent redemption and changes the credential epoch once', async () => {
    const owner = await account(), { token } = await issue();
    const responses = await Promise.all([redeem(token!, 'Concurrent123'), redeem(token!, 'Concurrent456')]);
    assert.deepEqual(responses.map((result) => result.status).sort(), [204, 400]);
    assert.equal((await users.findById(owner.userId).select('+credentialVersion').exec())!.credentialVersion, 1);
    assert.equal(await records().countDocuments({}), 0);
  });
  it('rolls token consumption back when the password write fails, allowing a safe retry', async () => {
    await account(); const { token } = await issue();
    const failure = mock.method(app.get(UsersService), 'replacePassword', async () => { throw new Error('simulated write outage'); });
    try { const response = await redeem(token!).expect(500); assert.equal(response.headers['set-cookie'], undefined); assert.equal(await records().countDocuments({}), 1); }
    finally { failure.mock.restore(); }
    await redeem(token!).expect(204);
  });
  it('rejects reset links after an administrator changes the password and clears restricted sessions on recovery', async () => {
    const owner = await account(), first = (await issue()).token!;
    await app.get(PasswordManagementService).setTemporaryPassword(owner.userId, { temporaryPassword: 'Temporary123' });
    await redeem(first).expect(400);
    const restricted = await http().post('/api/auth/login').send({ email: owner.email, password: 'Temporary123' }).expect(200);
    assert.equal(restricted.body.passwordChangeRequired, true);
    const second = (await issue()).token!; await redeem(second).expect(204);
    await http().patch('/api/auth/change-password').set('Cookie', cookies(restricted)).send({ currentPassword: 'Temporary123', newPassword: 'OtherPassword123' }).expect(401);
    await http().get('/api/auth/me').set('Cookie', owner.cookie).expect(401);
  });
  it('does not overwrite an administrator reset that races password hashing', async () => {
    const owner = await account(), { token } = await issue(), started = deferred(), gate = deferred();
    const hasher = app.get(PasswordService), original = hasher.hash.bind(hasher);
    const hash = mock.method(hasher, 'hash', async (password: string) => { if (password === NEW_PASSWORD) { started.resolve(); await gate.promise; } return original(password); });
    const pending = redeem(token!).then((response) => response);
    try { await started.promise; await app.get(PasswordManagementService).setTemporaryPassword(owner.userId, { temporaryPassword: 'Temporary123' }); }
    finally { gate.resolve(); }
    try { assert.equal((await pending).status, 400); } finally { hash.mock.restore(); }
    await http().post('/api/auth/login').send({ email: owner.email, password: 'Temporary123' }).expect(200);
  });
  it('cannot redeem an old link if a newer request arrives during password hashing', async () => {
    await account(); const first = (await issue()).token!, started = deferred(), gate = deferred();
    const hasher = app.get(PasswordService), original = hasher.hash.bind(hasher);
    const hash = mock.method(hasher, 'hash', async (password: string) => { if (password === NEW_PASSWORD) { started.resolve(); await gate.promise; } return original(password); });
    const pending = redeem(first).then((response) => response); let second: string;
    try { await started.promise; second = (await issue()).token!; } finally { gate.resolve(); }
    try { assert.equal((await pending).status, 400); } finally { hash.mock.restore(); }
    await redeem(second!, 'NewestPassword123').expect(204);
  });
  it('rejects redemption after suspension or deactivation without changing account state', async () => {
    const owner = await account(), { token } = await issue();
    for (const status of [AccountStatus.SUSPENDED, AccountStatus.DEACTIVATED]) {
      await users.updateOne({ _id: owner.userId }, { $set: { status } }); await redeem(token!).expect(400);
      assert.equal((await users.findById(owner.userId))!.status, status);
    }
  });
  it('keeps delivery errors private and invalidates the undelivered token', async () => {
    await account(); sendHook = async () => { throw new Error('simulated SMTP outage'); };
    const result = (await issue()).result; assert.equal(result.body.message.includes('If an eligible account'), true);
    assert.equal(sent.length, 0); assert.equal(await records().countDocuments({}), 0);
    sendHook = undefined; const { token } = await issue(); await redeem(token!).expect(204);
  });
  it('does not delete a newer link when an older delivery fails late', async () => {
    await account(); const started = deferred(), gate = deferred(); let attempts = 0;
    sendHook = async () => { if (++attempts === 1) { started.resolve(); await gate.promise; throw new Error('late delivery failure'); } };
    await http().post('/api/auth/forgot-password').send({ email: 'recover@example.com' }).expect(202); await started.promise;
    await http().post('/api/auth/forgot-password').send({ email: 'recover@example.com' }).expect(202);
    // The second job completes independently; release the first after its replacement is accepted.
    gate.resolve(); await recovery.whenIdle();
    assert.equal(sent.length, 1); await redeem(tokenFrom(sent[0])).expect(204);
  });
  it('silently limits requests per normalized email while retaining the latest accepted link', async () => {
    await account(); for (let n = 0; n < 5; n++) await issue(' RECOVER@EXAMPLE.COM ');
    const latest = tokenFrom(sent[4]); const before = (await records().findOne({}))!.tokenHash;
    const limited = await issue(); assert.equal(limited.result.status, 202); assert.equal(sent.length, 5); assert.equal((await records().findOne({}))!.tokenHash, before);
    await redeem(latest).expect(204);
  });
  it('limits request flooding by IP even across different unknown emails', async () => {
    for (let n = 0; n < 21; n++) await issue('unknown' + n + '@example.com');
    assert.equal(await records().countDocuments({}), 20); assert.equal(sent.length, 0);
    const stored = await connection.collection('passwordrecoverylimits').find({}).toArray();
    assert.ok(stored.every((row) => /^[a-f0-9]{64}$/.test(row._id as unknown as string))); assert.equal(JSON.stringify(stored).includes('@example.com'), false);
  });
  it('limits reset-token guesses without consuming another valid token', async () => {
    await account(); const { token } = await issue();
    for (let n = 0; n < 20; n++) await redeem(randomBytes(32).toString('hex')).expect(400);
    const result = await redeem(token!).expect(429); assert.equal(result.headers['set-cookie'], undefined); assert.equal(await records().countDocuments({}), 1);
  });
  it('has uniform configuration errors but accepts an already-issued token during mail downtime', async () => {
    await account(); const { token } = await issue(); configured = false;
    for (const email of ['recover@example.com', 'unknown@example.com']) await http().post('/api/auth/forgot-password').send({ email }).expect(503);
    await redeem(token!).expect(204);
  });
  it('rejects cross-origin writes and documents both public recovery routes and write-only token', async () => {
    await account(); const { token } = await issue();
    await http().post('/api/auth/forgot-password').set('Origin', 'https://attacker.example').send({ email: 'recover@example.com' }).expect(403);
    await redeem(token!).set('Origin', 'https://attacker.example').expect(403);
    const document = (await http().get('/api/docs-json').expect(200)).body;
    assert.match(document.paths['/api/auth/forgot-password'].post.summary, /ACC-07/);
    assert.ok(document.paths['/api/auth/reset-password'].post.responses['204']);
    assert.equal(document.components.schemas.ResetPasswordDto.properties.token.writeOnly, true);
    await redeem(token!).expect(204);
  });
});
