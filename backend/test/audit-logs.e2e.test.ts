import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { AuditAction, AuditTargetType } from '../src/audit-logs/audit-log.enums';
import { AuditLogsModule } from '../src/audit-logs/audit-logs.module';
import { AuditLogsService } from '../src/audit-logs/audit-logs.service';
import { UserRole } from '../src/common/enums/user-role.enum';
import { AdminFixture, Session } from './admin-fixture';

describe('GEN-07 audit logs', { concurrency: false }, () => {
  const fixture = new AdminFixture([AuditLogsModule]);
  let admin: Session;
  let otherAdmin: Session;
  let user: Session;
  let service: AuditLogsService;

  const target = () => new Types.ObjectId().toString();
  const list = (query = '') => fixture.http().get(`/api/admin/audit-logs${query}`).set('Cookie', admin.cookie);

  before(async () => {
    await fixture.start('audit-logs');
    service = fixture.app.get(AuditLogsService);
  }, { timeout: 30 * 60_000 });
  after(() => fixture.stop());

  beforeEach(async () => {
    await fixture.reset();
    admin = await fixture.login('admin@example.com', UserRole.ADMIN, 'Main Admin');
    otherAdmin = await fixture.login('admin2@example.com', UserRole.ADMIN, 'Second Admin');
    user = await fixture.login('user@example.com', UserRole.USER, 'Traveller');
  });

  it('GEN-07: records an admin action and lists it with the admin name', async () => {
    const targetId = target();
    await service.log({ adminId: admin.userId, action: AuditAction.ACCOUNT_SUSPENDED, targetType: AuditTargetType.USER, targetId, details: 'Abusive comments' });

    const response = await list().expect(200);
    assert.equal(response.body.total, 1);
    assert.equal(response.body.page, 1);
    assert.equal(response.body.pageSize, 10);
    const [entry] = response.body.items;
    assert.equal(entry.adminId, admin.userId);
    assert.equal(entry.adminName, 'Main Admin');
    assert.equal(entry.action, 'ACCOUNT_SUSPENDED');
    assert.equal(entry.targetType, 'USER');
    assert.equal(entry.targetId, targetId);
    assert.equal(entry.details, 'Abusive comments');
    assert.ok(entry.auditLogId);
    assert.ok(Date.parse(entry.createdAt));
    assert.equal(response.headers['cache-control'], 'no-store');
  });

  it('GEN-07/GEN-05: lists newest first, 10 per page', async () => {
    for (let index = 0; index < 12; index += 1) {
      await service.log({ adminId: admin.userId, action: AuditAction.CONTENT_DELETED, targetType: AuditTargetType.POST, targetId: target(), details: `entry ${index}` });
    }
    const first = await list().expect(200);
    assert.equal(first.body.total, 12);
    assert.equal(first.body.items.length, 10);
    assert.equal(first.body.items[0].details, 'entry 11');
    assert.equal(first.body.items[9].details, 'entry 2');

    const second = await list('?page=2').expect(200);
    assert.deepEqual(second.body.items.map((item: { details: string }) => item.details), ['entry 1', 'entry 0']);
  });

  it('GEN-07: filters by action, target type, admin and date range', async () => {
    await service.log({ adminId: admin.userId, action: AuditAction.ACCOUNT_SUSPENDED, targetType: AuditTargetType.USER, targetId: target() });
    await service.log({ adminId: otherAdmin.userId, action: AuditAction.PROVIDER_DEACTIVATED, targetType: AuditTargetType.HOTEL, targetId: target() });
    await service.log({ adminId: otherAdmin.userId, action: AuditAction.CONTENT_HIDDEN, targetType: AuditTargetType.POST, targetId: target() });

    assert.equal((await list('?action=ACCOUNT_SUSPENDED').expect(200)).body.total, 1);
    assert.equal((await list('?targetType=HOTEL').expect(200)).body.total, 1);
    assert.equal((await list(`?adminId=${otherAdmin.userId}`).expect(200)).body.total, 2);

    const past = '2000-01-01T00:00:00Z';
    const future = '2100-01-01T00:00:00Z';
    assert.equal((await list(`?from=${past}&to=${future}`).expect(200)).body.total, 3);
    assert.equal((await list(`?from=${future}`).expect(200)).body.total, 0);
    assert.equal((await list(`?to=${past}`).expect(200)).body.total, 0);
  });

  it('GEN-07/GEN-13: rejects invalid filters', async () => {
    await list('?action=EXPLODE').expect(400);
    await list('?targetType=SPACESHIP').expect(400);
    await list('?adminId=not-an-id').expect(400);
    await list('?from=yesterday').expect(400);
    await list('?page=0').expect(400);
    await list('?unknown=1').expect(400);
    const reversed = await list('?from=2026-11-10T00:00:00Z&to=2026-11-01T00:00:00Z').expect(400);
    assert.deepEqual(reversed.body.errors, { from: ['From must not be after To'] });
  });

  it('GEN-07: only administrators can read the audit log', async () => {
    await fixture.http().get('/api/admin/audit-logs').expect(401);
    await fixture.http().get('/api/admin/audit-logs').set('Cookie', user.cookie).expect(403);
    const airlineModerator = await fixture.login('air@example.com', UserRole.AIRLINE_MODERATOR);
    const hotelModerator = await fixture.login('hotel@example.com', UserRole.HOTEL_MODERATOR);
    await fixture.http().get('/api/admin/audit-logs').set('Cookie', airlineModerator.cookie).expect(403);
    await fixture.http().get('/api/admin/audit-logs').set('Cookie', hotelModerator.cookie).expect(403);
  });

  it('GEN-07: refuses entries without valid IDs and stores nothing', async () => {
    await assert.rejects(service.log({ adminId: 'nope', action: AuditAction.ACCOUNT_SUSPENDED, targetType: AuditTargetType.USER, targetId: target() }));
    await assert.rejects(service.log({ adminId: admin.userId, action: AuditAction.ACCOUNT_SUSPENDED, targetType: AuditTargetType.USER, targetId: 'nope' }));
    assert.equal(await fixture.connection.collection('auditlogs').countDocuments(), 0);
  });

  it('lists the endpoint in Swagger with GEN-07', async () => {
    const document = (await fixture.http().get('/api/docs-json').expect(200)).body;
    assert.match(document.paths['/api/admin/audit-logs'].get.summary, /^GEN-07/);
  });
});
