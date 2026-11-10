import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { UserRole } from '../src/common/enums/user-role.enum';
import { PoliciesService } from '../src/payments/policies.service';
import { PaymentsFixture } from './payments-fixture';

describe('PAY-02 booking policy acceptance', { concurrency: false }, () => {
  const fixture = new PaymentsFixture();
  let owner: { cookie: string; userId: string };
  let stranger: { cookie: string; userId: string };
  let bookingId: string;
  let policies: PoliciesService;

  const acceptances = () => fixture.connection.collection('policyacceptances');

  before(async () => {
    await fixture.start('payments-policies');
    policies = fixture.app.get(PoliciesService);
  }, { timeout: 30 * 60_000 });

  after(() => fixture.stop());

  beforeEach(async () => {
    await fixture.reset();
    owner = await fixture.login('owner@example.com');
    stranger = await fixture.login('stranger@example.com');
    bookingId = await fixture.holdBooking(owner.cookie);
  });

  it('shows the airline policies and the booking amount to the owner', async () => {
    const response = await fixture.http().get(`/api/bookings/flight/${bookingId}/policies`).set('Cookie', owner.cookie).expect(200);
    assert.deepEqual(response.body, {
      bookingType: 'flight',
      bookingId,
      amount: 150,
      currency: 'USD',
      policies: {
        cancellation: { tiers: [{ daysBeforeDeparture: 0, refundPercentage: 10 }, { daysBeforeDeparture: 7, refundPercentage: 50 }] },
        baggage: [{ airlineId: fixture.airlineId.toString(), pricePerExtraBag: 30, maxExtraBagsPerPassenger: 2 }],
      },
    });
    assert.equal(response.headers['cache-control'], 'no-store');
  });

  it('rejects guests, other roles, other users and invalid parameters', async () => {
    await fixture.http().get(`/api/bookings/flight/${bookingId}/policies`).expect(401);
    const admin = await fixture.login('admin@example.com', UserRole.ADMIN);
    await fixture.http().get(`/api/bookings/flight/${bookingId}/policies`).set('Cookie', admin.cookie).expect(403);
    // Another user's booking is 404, so its existence is not leaked.
    await fixture.http().get(`/api/bookings/flight/${bookingId}/policies`).set('Cookie', stranger.cookie).expect(404);
    await fixture.http().post(`/api/bookings/flight/${bookingId}/accept-policies`).set('Cookie', stranger.cookie).send({ accepted: true }).expect(404);
    await fixture.http().get(`/api/bookings/flight/${new Types.ObjectId().toString()}/policies`).set('Cookie', owner.cookie).expect(404);
    // A flight booking id is not a hotel reservation.
    await fixture.http().get(`/api/bookings/hotel/${bookingId}/policies`).set('Cookie', owner.cookie).expect(404);
    const badType = await fixture.http().get(`/api/bookings/train/${bookingId}/policies`).set('Cookie', owner.cookie).expect(400);
    assert.deepEqual(badType.body.errors, { type: ['type must be flight or hotel'] });
    await fixture.http().get('/api/bookings/flight/not-an-id/policies').set('Cookie', owner.cookie).expect(400);
    assert.equal(await acceptances().countDocuments(), 0);
  });

  it('stores one acceptance per booking, even when accepted twice or in parallel', async () => {
    const accept = () => fixture.http().post(`/api/bookings/flight/${bookingId}/accept-policies`).set('Cookie', owner.cookie).send({ accepted: true });
    const first = await accept().expect(200);
    assert.equal(first.body.userId, owner.userId);
    assert.equal(first.body.flightBookingId, bookingId);
    await accept().expect(200);
    await Promise.all([accept().expect(200), accept().expect(200), accept().expect(200)]);
    assert.equal(await acceptances().countDocuments(), 1);
  });

  it('requires the acceptance checkbox and stores the acceptance with a timestamp', async () => {
    const url = `/api/bookings/flight/${bookingId}/accept-policies`;
    for (const body of [{}, { accepted: false }, { accepted: 'true' }, { accepted: true, extra: 1 }]) {
      await fixture.http().post(url).set('Cookie', owner.cookie).send(body).expect(400);
    }
    const missing = await fixture.http().post(url).set('Cookie', owner.cookie).send({}).expect(400);
    assert.deepEqual(missing.body.errors, { accepted: ['You must accept the booking policies'] });
    assert.equal(await acceptances().countDocuments(), 0);

    const before = Date.now();
    await fixture.http().post(url).set('Cookie', owner.cookie).send({ accepted: true }).expect(200);
    const stored = await acceptances().findOne();
    assert.ok(stored!.acceptedAt instanceof Date && stored!.acceptedAt.getTime() >= before - 1000);
  });

  it('counts an acceptance only while the policies are unchanged', async () => {
    await fixture.http().post(`/api/bookings/flight/${bookingId}/accept-policies`).set('Cookie', owner.cookie).send({ accepted: true }).expect(200);
    const current = (await fixture.http().get(`/api/bookings/flight/${bookingId}/policies`).set('Cookie', owner.cookie)).body.policies;
    assert.equal(await policies.hasAccepted(owner.userId, 'flight', bookingId, current), true);
    // A stored snapshot equals the same policies with an undefined optional field.
    assert.equal(await policies.hasAccepted(owner.userId, 'flight', bookingId, { ...current, checkInOut: undefined }), true);
    assert.equal(await policies.hasAccepted(stranger.userId, 'flight', bookingId, current), false);

    // The airline changes its tiers: the user must accept again.
    await fixture.connection.collection('airlines').updateOne({ _id: fixture.airlineId }, { $set: { cancellationTiers: [] } });
    const changed = (await fixture.http().get(`/api/bookings/flight/${bookingId}/policies`).set('Cookie', owner.cookie)).body.policies;
    assert.equal(await policies.hasAccepted(owner.userId, 'flight', bookingId, changed), false);
    await fixture.http().post(`/api/bookings/flight/${bookingId}/accept-policies`).set('Cookie', owner.cookie).send({ accepted: true }).expect(200);
    assert.equal(await policies.hasAccepted(owner.userId, 'flight', bookingId, changed), true);
    assert.equal(await acceptances().countDocuments(), 1);
  });

  it('refuses acceptance once the booking is no longer PENDING', async () => {
    await fixture.connection.collection('flightbookings').updateOne({ _id: new Types.ObjectId(bookingId) }, { $set: { status: 'EXPIRED' } });
    const response = await fixture.http().post(`/api/bookings/flight/${bookingId}/accept-policies`).set('Cookie', owner.cookie).send({ accepted: true }).expect(409);
    assert.equal(response.body.message, 'Policies can only be accepted while the booking is PENDING');
    assert.equal(await acceptances().countDocuments(), 0);
  });

  it('lists both endpoints in Swagger with their requirement ID', async () => {
    const document = (await fixture.http().get('/api/docs-json').expect(200)).body;
    assert.match(document.paths['/api/bookings/{type}/{id}/policies'].get.summary, /^PAY-02/);
    assert.match(document.paths['/api/bookings/{type}/{id}/accept-policies'].post.summary, /^PAY-02/);
  });
});
