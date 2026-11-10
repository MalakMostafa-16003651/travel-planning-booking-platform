import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { AirlinesModule } from '../src/airlines/airlines.module';
import { AuditAction, AuditTargetType } from '../src/audit-logs/audit-log.enums';
import { AuditLogsService } from '../src/audit-logs/audit-logs.service';
import { UserRole } from '../src/common/enums/user-role.enum';
import { HotelsModule } from '../src/hotels/hotels.module';
import { ReferenceDataService } from '../src/reference-data/reference-data.service';
import { AdminFixture, Session } from './admin-fixture';

const providers = [
  { route: 'hotels', collection: 'hotels', action: AuditAction.HOTEL_CREATED, targetType: AuditTargetType.HOTEL,
    body: { name: 'Atomic hotel', city: 'Cairo', countryCode: 'EG', address: '12 Test Street' } },
  { route: 'airlines', collection: 'airlines', action: AuditAction.AIRLINE_CREATED, targetType: AuditTargetType.AIRLINE,
    body: { name: 'Atomic airline', code: 'ZX' } },
];

describe('GEN-07 provider creation and audit atomicity', { concurrency: false }, () => {
  const fixture = new AdminFixture([HotelsModule, AirlinesModule]);
  let admin: Session;
  let audits: AuditLogsService;
  before(async () => {
    await fixture.start('provider-create-audit');
    audits = fixture.app.get(AuditLogsService);
  }, { timeout: 120_000 });
  beforeEach(async () => {
    await fixture.reset();
    await fixture.app.get(ReferenceDataService).seedSupported();
    admin = await fixture.login('provider-admin@example.com', UserRole.ADMIN);
  });
  after(() => fixture.stop());

  const call = (route: string, body: object) => fixture.http().post('/api/' + route).set('Cookie', admin.cookie).send(body);
  const count = (collection: string) => fixture.connection.collection(collection).countDocuments({});
  async function assertCommitted(provider: typeof providers[number], id: string) {
    assert.ok(Types.ObjectId.isValid(id));
    assert.equal(await count(provider.collection), 1);
    assert.equal(await count('auditlogs'), 1);
    const entry = await fixture.connection.collection('auditlogs').findOne({ targetId: new Types.ObjectId(id) });
    assert.ok(entry);
    assert.equal(entry.action, provider.action);
    assert.equal(entry.targetType, provider.targetType);
    assert.equal(entry.adminId.toString(), admin.userId);
  }

  for (const provider of providers) {
    it(provider.route + ': commits the provider and one audit for the authenticated administrator', async () => {
      const response = await call(provider.route, provider.body).expect(201);
      await assertCommitted(provider, response.body._id);
    });

    for (const phase of ['before', 'after'] as const) {
      it(provider.route + ': rolls back when audit fails ' + phase + ' its insert, then retries without an orphan or duplicate', async (context) => {
        const original = audits.log.bind(audits);
        const failure = context.mock.method(audits, 'log', async (...args: Parameters<AuditLogsService['log']>) => {
          if (phase === 'after') await original(...args);
          throw new Error('Injected audit failure');
        });
        try {
          await call(provider.route, provider.body).expect(500);
          assert.equal(await count(provider.collection), 0);
          assert.equal(await count('auditlogs'), 0);
        } finally { failure.mock.restore(); }
        const response = await call(provider.route, provider.body).expect(201);
        await assertCommitted(provider, response.body._id);
      });
    }
  }

  it('keeps duplicate airline codes as 409 and leaves the original provider/audit intact', async () => {
    const provider = providers[1];
    const response = await call(provider.route, provider.body).expect(201);
    await call(provider.route, provider.body).expect(409);
    await assertCommitted(provider, response.body._id);
  });

  it('rejects an invalid hotel reference before creating a provider or audit', async () => {
    await call('hotels', { ...providers[0].body, city: 'Unknown reference city' }).expect(400);
    assert.equal(await count('hotels'), 0);
    assert.equal(await count('auditlogs'), 0);
  });

  it('does not mislabel an audit duplicate-write failure as an airline-code conflict', async (context) => {
    const failure = context.mock.method(audits, 'log', async () => {
      throw Object.assign(new Error('Injected audit duplicate failure'), { code: 11000 });
    });
    try {
      await call('airlines', providers[1].body).expect(500);
      assert.equal(await count('airlines'), 0);
      assert.equal(await count('auditlogs'), 0);
    } finally { failure.mock.restore(); }
  });
});
