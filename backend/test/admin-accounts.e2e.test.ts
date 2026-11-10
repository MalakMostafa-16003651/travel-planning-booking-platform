import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { AdminModule } from '../src/admin/admin.module';
import { UserRole } from '../src/common/enums/user-role.enum';
import { AdminFixture, PASSWORD, Session } from './admin-fixture';

describe('ACC-14/15/16 account management', { concurrency: false }, () => {
  const fixture = new AdminFixture([AdminModule]);
  let admin: Session;
  let user: Session;
  let moderator: Session;

  const accounts = (query = '') => fixture.http().get(`/api/admin/accounts${query}`).set('Cookie', admin.cookie);
  const suspend = (id: string, body: object = {}) => fixture.http().patch(`/api/admin/accounts/${id}/suspend`).set('Cookie', admin.cookie).send(body);
  const reactivate = (id: string, body: object = {}) => fixture.http().patch(`/api/admin/accounts/${id}/reactivate`).set('Cookie', admin.cookie).send(body);
  const tryLogin = (email: string) => fixture.http().post('/api/auth/login').set('Sec-Fetch-Site', 'same-origin').send({ email, password: PASSWORD });
  const auditLogs = () => fixture.connection.collection('auditlogs').find().toArray();
  const notificationsOf = (userId: string) => fixture.connection.collection('notifications').find({ userId: new Types.ObjectId(userId) }).toArray();

  before(() => fixture.start('admin-accounts'), { timeout: 30 * 60_000 });
  after(() => fixture.stop());

  beforeEach(async () => {
    await fixture.reset();
    admin = await fixture.login('admin@example.com', UserRole.ADMIN, 'Main Admin');
    user = await fixture.login('nour@example.com', UserRole.USER, 'Nour Explorer');
    moderator = await fixture.login('desk@nileair.com', UserRole.AIRLINE_MODERATOR, 'Nile Air Desk');
  });

  it('ACC-14: lists accounts with name, email, role, status and registration date, without secrets', async () => {
    const response = await accounts().expect(200);
    assert.equal(response.body.total, 3);
    assert.equal(response.body.pageSize, 10);
    const nour = response.body.items.find((item: { email: string }) => item.email === 'nour@example.com');
    assert.deepEqual(Object.keys(nour).sort(), ['createdAt', 'email', 'name', 'role', 'status', 'userId']);
    assert.equal(nour.userId, user.userId);
    assert.equal(nour.name, 'Nour Explorer');
    assert.equal(nour.role, 'USER');
    assert.equal(nour.status, 'ACTIVE');
    assert.ok(Date.parse(nour.createdAt));
    assert.equal(JSON.stringify(response.body).includes('passwordHash'), false);
    assert.equal(response.headers['cache-control'], 'no-store');
  });

  it('ACC-14: searches by name or email, case-insensitively and literally', async () => {
    assert.deepEqual((await accounts('?search=EXPLORER').expect(200)).body.items.map((item: { email: string }) => item.email), ['nour@example.com']);
    assert.deepEqual((await accounts('?search=nileair').expect(200)).body.items.map((item: { email: string }) => item.email), ['desk@nileair.com']);
    // Regex characters are matched literally, not as a pattern.
    assert.equal((await accounts(`?search=${encodeURIComponent('.*')}`).expect(200)).body.total, 0);
  });

  it('ACC-14: filters by role and status, and pages 10 at a time', async () => {
    assert.equal((await accounts('?role=AIRLINE_MODERATOR').expect(200)).body.total, 1);
    await suspend(user.userId).expect(200);
    assert.deepEqual((await accounts('?status=SUSPENDED').expect(200)).body.items.map((item: { userId: string }) => item.userId), [user.userId]);

    for (let index = 0; index < 9; index += 1) await fixture.login(`extra${index}@example.com`);
    const first = await accounts().expect(200);
    assert.equal(first.body.total, 12);
    assert.equal(first.body.items.length, 10);
    assert.equal(first.body.items[0].email, 'extra8@example.com');
    assert.equal((await accounts('?page=2').expect(200)).body.items.length, 2);
  });

  it('ACC-16: a suspended user cannot log in, loses their session, and is notified and audited', async () => {
    const response = await suspend(user.userId, { reason: 'Abusive comments' }).expect(200);
    assert.equal(response.body.status, 'SUSPENDED');

    await fixture.http().get('/api/auth/me').set('Cookie', user.cookie).expect(401);
    const login = await tryLogin('nour@example.com').expect(403);
    assert.match(login.body.message, /suspended/i);

    const [entry] = await auditLogs();
    assert.equal(entry.action, 'ACCOUNT_SUSPENDED');
    assert.equal(entry.targetType, 'USER');
    assert.equal(entry.targetId.toString(), user.userId);
    assert.equal(entry.adminId.toString(), admin.userId);
    assert.equal(entry.details, 'Abusive comments');

    const [notification] = await notificationsOf(user.userId);
    assert.equal(notification.type, 'ACCOUNT_SUSPENDED');
  });

  it('ACC-15: suspends and reactivates a moderator, who can then log in again', async () => {
    await suspend(moderator.userId).expect(200);
    await tryLogin('desk@nileair.com').expect(403);

    const response = await reactivate(moderator.userId, { reason: 'Appeal accepted' }).expect(200);
    assert.equal(response.body.status, 'ACTIVE');
    await tryLogin('desk@nileair.com').expect(200);

    const actions = (await auditLogs()).map((entry) => entry.action).sort();
    assert.deepEqual(actions, ['ACCOUNT_REACTIVATED', 'ACCOUNT_SUSPENDED']);
    const types = (await notificationsOf(moderator.userId)).map((entry) => entry.type).sort();
    assert.deepEqual(types, ['ACCOUNT_REACTIVATED', 'ACCOUNT_SUSPENDED']);
  });

  it('ACC-15/16: rejects invalid status changes without auditing them', async () => {
    await reactivate(user.userId).expect(409);
    await suspend(user.userId).expect(200);
    await suspend(user.userId).expect(409);

    const otherAdmin = await fixture.login('admin2@example.com', UserRole.ADMIN);
    await suspend(otherAdmin.userId).expect(400);
    await suspend(admin.userId).expect(400);

    await fixture.users.updateOne({ _id: new Types.ObjectId(moderator.userId) }, { $set: { status: 'DEACTIVATED' } }).exec();
    await reactivate(moderator.userId).expect(409);

    await suspend(new Types.ObjectId().toString()).expect(404);
    await suspend('not-an-id').expect(400);
    await suspend(user.userId, { reason: 'x' }).expect(400);
    await suspend(user.userId, { status: 'ACTIVE' }).expect(400);

    assert.equal((await auditLogs()).length, 1);
  });

  it('ACC-15/16: two admins suspending at once produce one change and one audit entry', async () => {
    const results = await Promise.all([suspend(user.userId), suspend(user.userId)]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
    assert.equal((await auditLogs()).length, 1);
    assert.equal((await notificationsOf(user.userId)).length, 1);
  });

  it('ACC-14/15/16: only administrators can use these endpoints', async () => {
    for (const session of [user, moderator]) {
      await fixture.http().get('/api/admin/accounts').set('Cookie', session.cookie).expect(403);
      await fixture.http().patch(`/api/admin/accounts/${user.userId}/suspend`).set('Cookie', session.cookie).send({}).expect(403);
    }
    await fixture.http().get('/api/admin/accounts').expect(401);
    await fixture.http().patch(`/api/admin/accounts/${user.userId}/reactivate`).send({}).expect(401);
  });

  it('lists every endpoint in Swagger with its requirement ID', async () => {
    const document = (await fixture.http().get('/api/docs-json').expect(200)).body;
    const operations: [string, string, RegExp][] = [
      ['/api/admin/accounts', 'get', /^ACC-14/],
      ['/api/admin/accounts/{id}/suspend', 'patch', /^ACC-15\/ACC-16/],
      ['/api/admin/accounts/{id}/reactivate', 'patch', /^ACC-15\/ACC-16/],
    ];
    for (const [path, method, summary] of operations) assert.match(document.paths[path][method].summary, summary, `${method} ${path}`);
  });
});
