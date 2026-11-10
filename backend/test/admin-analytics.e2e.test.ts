import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { AdminAnalyticsModule } from '../src/admin-analytics/admin-analytics.module';
import { allocateMinor } from '../src/admin-analytics/allocate-minor';
import { UserRole } from '../src/common/enums/user-role.enum';
import { StripeService } from '../src/payments/stripe.service';
import { FakeStripe, TEST_STRIPE_CONFIG } from './fake-stripe';
import { PaymentsFixture } from './payments-fixture';

// Arithmetic invariants: stable gross attribution, cent conservation, safe large values.
describe('BON-01 exact receipt attribution', () => {
  it('reconciles all cents including tiny refunds, repeated providers, zero fares and large safe amounts', () => {
    const sources = [ [{ id: 'a', weight: 1 }, { id: 'b', weight: 2 }], [{ id: 'b', weight: 0 }, { id: 'a', weight: 0 }], [{ id: 'a', weight: 4 }, { id: 'b', weight: 1 }, { id: 'a', weight: 3 }] ];
    for (const providers of sources) for (const gross of [0, 1, 2, 101, 15001, Number.MAX_SAFE_INTEGER]) {
      const shares = allocateMinor(gross, providers);
      assert.equal([...shares.values()].reduce((a, b) => a + BigInt(b), 0n), BigInt(gross));
      assert.deepEqual(shares, allocateMinor(gross, [...providers].reverse()));
      for (const refund of [0, 1, Math.floor(gross / 2), gross].filter(value => value <= gross)) {
        const refunds = allocateMinor(refund, [...shares].map(([id, weight]) => ({ id, weight })));
        assert.equal([...refunds.values()].reduce((a, b) => a + BigInt(b), 0n), BigInt(refund));
        for (const [id, value] of refunds) assert.ok(value <= shares.get(id)!);
      }
    }
    assert.throws(() => allocateMinor(-1, sources[0]));
    assert.throws(() => allocateMinor(1, [{ id: 'a', weight: 0.1 }]));
  });
});

describe('BON-01 real admin analytics API', { concurrency: false }, () => {
  const fixture = new PaymentsFixture();
  let admin: { cookie: string; userId: string }, user: { cookie: string; userId: string }, stripe: FakeStripe;
  const col = (name: string) => fixture.connection.collection(name);
  const report = (query: Record<string, unknown> = {}) => fixture.http().get('/api/admin/analytics').set('Cookie', admin.cookie).query({ from: '2026-01-01', to: '2026-01-31', ...query });
  async function receipt(options: { type?: 'flight' | 'hotel'; providers?: Types.ObjectId[]; amount?: number; confirmedAt?: Date | null; status?: string; refunds?: { amount: number; status?: string; otherIntent?: boolean }[] } = {}) {
    const type = options.type ?? 'hotel', bookingId = new Types.ObjectId(), paymentId = new Types.ObjectId(), intent = 'pi_' + paymentId;
    const providers = options.providers ?? [new Types.ObjectId()];
    const confirmedAt = options.confirmedAt === undefined ? new Date('2026-01-15T12:00:00Z') : options.confirmedAt;
    await col(type === 'hotel' ? 'hotelbookings' : 'flightbookings').insertOne({ _id: bookingId, userId: new Types.ObjectId(user.userId), paymentId, status: 'CONFIRMED',
      ...(type === 'hotel' ? { hotelId: providers[0] } : { segments: providers.map((airlineId, index) => ({ airlineId, fare: index === 0 ? 100 : 200 })) }) });
    await col('payments').insertOne({ _id: paymentId, userId: new Types.ObjectId(user.userId), bookingType: type, [type === 'hotel' ? 'hotelBookingId' : 'flightBookingId']: bookingId, amount: options.amount ?? 100,
      currency: 'USD', status: options.status ?? 'SUCCEEDED', stripePaymentIntentId: intent, ...(confirmedAt ? { bookingConfirmedAt: confirmedAt } : {}), createdAt: new Date('2025-12-01') });
    for (const refund of options.refunds ?? []) await col('refunds').insertOne({ paymentId, stripePaymentIntentId: refund.otherIntent ? 'pi_older_double_payment' : intent,
      stripeRefundId: 're_' + new Types.ObjectId(), status: refund.status ?? 'REFUNDED', amount: refund.amount, currency: 'USD', createdAt: new Date('2026-02-01') });
    return { bookingId, paymentId, providers };
  }
  before(async () => { await fixture.start('admin-analytics', undefined, TEST_STRIPE_CONFIG, [AdminAnalyticsModule]); }, { timeout: 120000 });
  after(() => fixture.stop());
  beforeEach(async () => {
    await fixture.reset(); stripe = new FakeStripe(); stripe.install(fixture.app.get(StripeService));
    admin = await fixture.login('analytics-admin@example.com', UserRole.ADMIN); user = await fixture.login('analytics-user@example.com');
  });
  it('requires an active admin and validates real inclusive dates, ordering, range, filters and pagination', async () => {
    await fixture.http().get('/api/admin/analytics').expect(401);
    for (const role of [UserRole.USER, UserRole.AIRLINE_MODERATOR, UserRole.HOTEL_MODERATOR]) {
      const account = role === UserRole.USER ? user : await fixture.login(role.toLowerCase() + '@example.com', role);
      await fixture.http().get('/api/admin/analytics').set('Cookie', account.cookie).query({ from: '2026-01-01', to: '2026-01-01' }).expect(403);
    }
    for (const query of [{ from: '2026-02-30' }, { from: '2026-02-01' }, { from: '2024-01-01' }, { page: 0 }, { page: 1.5 }, { type: 'USER' }, { from: '2026-01-01T00:00:00Z' }, { userId: user.userId }]) await report(query).expect(400);
    await report({ from: '2024-01-01', to: '2024-12-31' }).expect(200);
    await fixture.users.updateOne({ _id: admin.userId }, { $set: { status: 'SUSPENDED' } });
    await report().expect(401);
  });
  it('counts a real flight only after signed Stripe confirmation and reconciles its real cancellation refund', async () => {
    const id = await fixture.holdBooking(user.cookie), today = new Date().toISOString().slice(0, 10), query = { from: today, to: today };
    assert.equal((await report(query).expect(200)).body.total, 0);
    await fixture.http().post('/api/bookings/flight/' + id + '/accept-policies').set('Cookie', user.cookie).send({ accepted: true }).expect(200);
    const paying = await fixture.http().post('/api/payments').set('Cookie', user.cookie).send({ bookingType: 'flight', bookingId: id }).expect(201);
    assert.equal((await report(query).expect(200)).body.total, 0);
    const event = FakeStripe.signedEvent('payment_intent.succeeded', stripe.succeed(paying.body.payment.stripePaymentIntentId));
    await fixture.http().post('/api/payments/webhook').set('stripe-signature', event.signature).set('Content-Type', 'application/json').send(event.payload).expect(200);
    const first = await report(query).expect(200); assert.equal(first.headers['cache-control'], 'no-store');
    assert.equal(first.body.items[0].grossRevenueMinor, 15000); assert.equal(first.body.items[0].bookings, 1);
    await fixture.http().post('/api/flight-bookings/' + id + '/cancel').set('Cookie', user.cookie).expect(200);
    const pending = await report(query).expect(200);
    assert.equal(pending.body.items[0].refundedMinor, 0);
    const refund = await col('refunds').findOne({ flightBookingId: new Types.ObjectId(id) });
    const settled = FakeStripe.signedEvent('refund.updated', stripe.setRefundStatus(refund!.stripeRefundId, 'succeeded'));
    await fixture.http().post('/api/payments/webhook').set('stripe-signature', settled.signature).set('Content-Type', 'application/json').send(settled.payload).expect(200);
    const after = await report(query).expect(200);
    assert.equal(after.body.items[0].grossRevenueMinor, 15000); assert.equal(after.body.items[0].refundedMinor, 7500); assert.equal(after.body.items[0].netRevenueMinor, 7500);
  });
  it('keeps UTC boundaries, historical providers and completed cohort refunds, excluding failed/pending/compensation payments', async () => {
    const hotelId = new Types.ObjectId(); await col('hotels').insertOne({ _id: hotelId, name: 'Historical Hotel', isActive: false });
    await receipt({ providers: [hotelId], amount: 100.01, confirmedAt: new Date('2026-01-01T00:00:00Z'), refunds: [{ amount: 10 }, { amount: 5, status: 'PENDING' }, { amount: 8, status: 'FAILED' }, { amount: 100, otherIntent: true }] });
    await receipt({ providers: [hotelId], amount: 20, confirmedAt: new Date('2026-01-31T23:59:59.999Z'), status: 'REFUNDED', refunds: [{ amount: 20 }] });
    for (const confirmedAt of [new Date('2025-12-31T23:59:59.999Z'), new Date('2026-02-01T00:00:00Z'), null]) await receipt({ providers: [hotelId], confirmedAt });
    for (const status of ['PENDING', 'FAILED']) await receipt({ providers: [hotelId], status });
    const result = await report({ type: 'hotel' }).expect(200);
    assert.equal(result.body.total, 1); assert.deepEqual(result.body.items[0], { type: 'hotel', hotelId: hotelId.toString(), name: 'Historical Hotel', bookings: 2, grossRevenueMinor: 12001, refundedMinor: 3000, netRevenueMinor: 9001, currency: 'USD' });
    assert.equal((await report({ type: 'airline' }).expect(200)).body.total, 0);
    assert.ok(!JSON.stringify(result.body).includes(user.userId));
  });
  it('allocates mixed-airline and repeated-provider bookings without duplicating revenue or changing gross after refunds', async () => {
    const a = new Types.ObjectId('650000000000000000000001'), b = new Types.ObjectId('650000000000000000000002');
    await col('airlines').insertOne({ _id: a, code: 'AN', name: 'Airline A', isActive: false });
    const paid = await receipt({ type: 'flight', providers: [a, b], amount: 1.01 });
    const first = (await report().expect(200)).body.items;
    assert.equal(first.reduce((sum: number, row: { grossRevenueMinor: number }) => sum + row.grossRevenueMinor, 0), 101);
    await col('refunds').insertOne({ paymentId: paid.paymentId, stripePaymentIntentId: 'pi_' + paid.paymentId, stripeRefundId: 're_cent', status: 'REFUNDED', amount: 0.01, currency: 'USD', createdAt: new Date() });
    const after = (await report().expect(200)).body.items;
    for (const row of after) assert.equal(row.grossRevenueMinor, first.find((x: { airlineId: string }) => x.airlineId === row.airlineId).grossRevenueMinor);
    assert.equal(after.reduce((sum: number, row: { netRevenueMinor: number }) => sum + row.netRevenueMinor, 0), 100);
    await receipt({ type: 'flight', providers: [a, a], amount: 3 });
    const result = await report().expect(200); assert.equal(result.body.items.find((row: { airlineId: string }) => row.airlineId === a.toString()).bookings, 2);
    assert.equal(result.body.items.reduce((sum: number, row: { grossRevenueMinor: number }) => sum + row.grossRevenueMinor, 0), 401);
    // IDs are only unique within their collections, so names must be keyed by type too.
    await col('hotels').insertOne({ _id: a, name: 'Hotel with same ID', isActive: true });
    await receipt({ type: 'hotel', providers: [a], amount: 2 });
    const mixed = (await report().expect(200)).body.items;
    assert.equal(mixed.find((row: { airlineId?: string }) => row.airlineId === a.toString()).name, 'Airline A');
    assert.equal(mixed.find((row: { hotelId?: string }) => row.hotelId === a.toString()).name, 'Hotel with same ID');
  });
  it('paginates ten providers deterministically and exposes only the aggregate contract in Swagger', async () => {
    for (let i = 0; i < 12; i++) await receipt({ amount: i + 1 });
    const a = await report().expect(200), b = await report({ page: 2 }).expect(200);
    assert.equal(a.body.total, 12); assert.equal(a.body.items.length, 10); assert.equal(b.body.items.length, 2); assert.equal(a.body.pageSize, 10);
    assert.equal(new Set([...a.body.items, ...b.body.items].map((row: { hotelId: string }) => row.hotelId)).size, 12);
    assert.equal(a.body.items[0].grossRevenueMinor, 1200); assert.equal((await report({ page: 3 }).expect(200)).body.items.length, 0);
    const doc = await fixture.http().get('/api/docs-json').expect(200);
    assert.match(doc.body.paths['/api/admin/analytics'].get.summary, /BON-01/);
    assert.ok(doc.body.paths['/api/admin/analytics'].get.security.length);
    const keys = Object.keys(a.body.items[0]).sort(); assert.deepEqual(keys, ['type', 'hotelId', 'name', 'bookings', 'grossRevenueMinor', 'refundedMinor', 'netRevenueMinor', 'currency'].sort());
  });
  it('refuses partial or misleading totals when source money, provider references or refund sums are inconsistent', async () => {
    const record = await receipt();
    await col('payments').updateOne({ _id: record.paymentId }, { $set: { amount: 0.001 } }); await report().expect(503);
    await col('payments').updateOne({ _id: record.paymentId }, { $set: { amount: 100 } });
    await col('refunds').insertOne({ paymentId: record.paymentId, stripePaymentIntentId: 'pi_' + record.paymentId, stripeRefundId: 're_excess', status: 'REFUNDED', amount: 101, currency: 'USD', createdAt: new Date() }); await report().expect(503);
    await col('refunds').deleteMany({ paymentId: record.paymentId });
    await col('hotelbookings').deleteOne({ _id: record.bookingId }); await report().expect(503);
  });
});
