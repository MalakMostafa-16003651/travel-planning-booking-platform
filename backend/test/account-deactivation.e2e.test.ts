import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { getModelToken } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AuthSession } from '../src/auth/schemas/auth-session.schema';
import { BlogModule } from '../src/blog/blog.module';
import { UserRole } from '../src/common/enums/user-role.enum';
import { FlightBookingsService } from '../src/flight-bookings/flight-bookings.service';
import { HotelBookingsClock } from '../src/hotel-bookings/hotel-booking.dates';
import { HotelBookingsService } from '../src/hotel-bookings/hotel-bookings.service';
import { ItinerariesModule } from '../src/itineraries/itineraries.module';
import { StripeService } from '../src/payments/stripe.service';
import { ReviewsModule } from '../src/reviews/reviews.module';
import { AccountDeactivationModule } from '../src/users/account-deactivation.module';
import { UsersService } from '../src/users/users.service';
import { FakeStripe, TEST_STRIPE_CONFIG } from './fake-stripe';
import { PASSWORD, PaymentsFixture } from './payments-fixture';

type Session = { userId: string; cookie: string };
const TODAY = '2035-01-03';

describe('ACC-12 real account deactivation and booking serialization', { concurrency: false }, () => {
  const fixture = new PaymentsFixture();
  let owner: Session, stranger: Session;
  let stripe: FakeStripe;
  let users: UsersService;
  const account = () => fixture.connection.collection('users').findOne({ _id: new Types.ObjectId(owner.userId) });
  const deactivate = (session = owner, body: object = { confirmed: true }) => fixture.http().post('/api/users/me/deactivate').set('Cookie', session.cookie).send(body);
  const webhook = (intentId: string) => {
    const event = FakeStripe.signedEvent('payment_intent.succeeded', stripe.succeed(intentId));
    return fixture.http().post('/api/payments/webhook').set('stripe-signature', event.signature).set('Content-Type', 'application/json').send(event.payload);
  };
  async function hotelHold() {
    const hotelId = new Types.ObjectId(), roomId = new Types.ObjectId();
    await fixture.connection.collection('hotels').insertOne({ _id: hotelId, name: 'Deactivation hotel', city: 'Cairo', countryCode: 'EG', address: '1 Corniche',
      isActive: true, checkInTime: '14:00', checkOutTime: '12:00', cancellationTiers: [{ daysBeforeCheckIn: 1, refundPercentage: 100 }] });
    await fixture.connection.collection('rooms').insertOne({ _id: roomId, hotelId, name: 'Room one', isActive: true, capacity: 2, pricePerNight: 10000 });
    const held = await fixture.http().post('/api/hotel-bookings').set('Cookie', owner.cookie).send({ hotelId: hotelId.toString(), checkIn: '2035-01-10', checkOut: '2035-01-12',
      rooms: [{ roomId: roomId.toString(), adults: 1, childrenAges: [] }] }).expect(201);
    return { bookingId: held.body.hotelBookingId as string, hotelId, roomId };
  }
  async function pendingPayment(kind: 'flight' | 'hotel') {
    const bookingId = kind === 'flight' ? await fixture.holdBooking(owner.cookie) : (await hotelHold()).bookingId;
    await fixture.http().post(`/api/bookings/${kind}/${bookingId}/accept-policies`).set('Cookie', owner.cookie).send({ accepted: true }).expect(200);
    const paid = await fixture.http().post('/api/payments').set('Cookie', owner.cookie).send({ bookingType: kind, bookingId }).expect(201);
    return { bookingId, intentId: paid.body.payment.stripePaymentIntentId as string };
  }
  const booking = (kind: 'flight' | 'hotel', id: string) => fixture.connection.collection(kind === 'flight' ? 'flightbookings' : 'hotelbookings').findOne({ _id: new Types.ObjectId(id) });

  before(async () => {
    await fixture.start('account-deactivation', undefined, TEST_STRIPE_CONFIG, [AccountDeactivationModule, BlogModule, ItinerariesModule, ReviewsModule]);
    users = fixture.app.get(UsersService);
  }, { timeout: 30 * 60_000 });
  after(() => fixture.stop());
  beforeEach(async () => {
    await fixture.reset();
    fixture.app.get(HotelBookingsClock).today = () => TODAY;
    stripe = new FakeStripe(); stripe.install(fixture.app.get(StripeService));
    owner = await fixture.login('deactivate-owner@example.com'); stranger = await fixture.login('deactivate-stranger@example.com');
  });

  it('requires explicit consent, USER role, a real normal session and same-origin writes', async () => {
    for (const body of [{}, { confirmed: false }, { confirmed: 'true' }, { confirmed: true, userId: stranger.userId }, { confirmed: true, bookingVersion: 1 }])
      await deactivate(owner, body).expect(400);
    await fixture.http().post('/api/users/me/deactivate').send({ confirmed: true }).expect(401);
    for (const role of [UserRole.ADMIN, UserRole.AIRLINE_MODERATOR, UserRole.HOTEL_MODERATOR]) {
      const actor = await fixture.login(role.toLowerCase() + '@example.com', role); await deactivate(actor).expect(403);
    }
    await fixture.http().post('/api/users/me/deactivate').set('Cookie', owner.cookie).set('Origin', 'https://untrusted.example').send({ confirmed: true }).expect(403);
    assert.equal((await account())?.status, 'ACTIVE');
  });

  it('deactivates only the session owner, clears cookies, revokes all sessions/proofs and preserves account data', async () => {
    await fixture.http().post('/api/auth/login').send({ email: 'deactivate-owner@example.com', password: PASSWORD }).expect(200);
    const before = (await account())!;
    for (const [i, actor] of [owner, stranger].entries()) {
      await fixture.connection.collection('passwordresets').insertOne({ userId: new Types.ObjectId(actor.userId), emailDigest: 'email-' + i, tokenHash: 'reset-' + i, expiresAt: new Date(Date.now() + 86_400_000) });
      await fixture.connection.collection('emailverifications').insertOne({ userId: new Types.ObjectId(actor.userId), emailDigest: 'email-' + i, tokenHash: 'verify-' + i, expiresAt: new Date(Date.now() + 86_400_000) });
    }
    const done = await deactivate().expect(204); assert.equal(done.text, ''); assert.equal(done.headers['cache-control'], 'no-store');
    const cleared = done.headers['set-cookie'] as unknown as string[];
    for (const name of ['__Host-accessToken', '__Host-refreshToken', '__Host-passwordChangeToken']) {
      const cookie = cleared.find(value => value.startsWith(name + '=')); assert.ok(cookie);
      assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i); assert.match(cookie, /SameSite=Lax/i); assert.match(cookie, /Expires=/i);
    }
    const after = (await account())!;
    assert.equal(after.status, 'DEACTIVATED'); assert.equal(after.credentialVersion, before.credentialVersion + 1);
    assert.equal(after.bookingVersion, before.bookingVersion + 1); assert.equal(after.passwordHash, before.passwordHash); assert.equal(after.email, before.email);
    const sessions = await fixture.connection.collection('authsessions').find({ userId: new Types.ObjectId(owner.userId) }).toArray();
    assert.ok(sessions.length >= 2); assert.ok(sessions.every(row => row.revokedAt instanceof Date));
    for (const collection of ['passwordresets', 'emailverifications']) {
      assert.equal(await fixture.connection.collection(collection).countDocuments({ userId: new Types.ObjectId(owner.userId) }), 0);
      assert.equal(await fixture.connection.collection(collection).countDocuments({ userId: new Types.ObjectId(stranger.userId) }), 1);
    }
    await fixture.http().get('/api/auth/me').set('Cookie', owner.cookie).expect(401);
    await fixture.http().get('/api/users/me').set('Cookie', owner.cookie).expect(401);
    await fixture.http().post('/api/auth/login').send({ email: 'deactivate-owner@example.com', password: PASSWORD }).expect(401);
    await fixture.http().get('/api/auth/me').set('Cookie', stranger.cookie).expect(200);
  });

  it('blocks a future return flight even after the outbound departed, rolling back the gate and retaining sessions', async () => {
    await fixture.connection.collection('flightbookings').insertOne({ userId: new Types.ObjectId(owner.userId), status: 'CONFIRMED',
      lastDepartureAt: new Date(Date.now() + 86_400_000), segments: [{ departureAt: new Date(0) }, { departureAt: new Date(Date.now() + 86_400_000) }] });
    const before = (await account())!;
    const denied = await deactivate().expect(409); assert.equal(denied.headers['set-cookie'], undefined);
    assert.equal((await account())?.bookingVersion, before.bookingVersion); assert.equal((await account())?.credentialVersion, before.credentialVersion);
    await fixture.http().get('/api/auth/me').set('Cookie', owner.cookie).expect(200);
  });

  it('blocks an ongoing Confirmed hotel stay until its UTC checkout date', async () => {
    fixture.app.get(HotelBookingsClock).today = () => '2035-01-11';
    await fixture.connection.collection('hotelbookings').insertOne({ userId: new Types.ObjectId(owner.userId), status: 'CONFIRMED', checkIn: '2035-01-10', checkOut: '2035-01-12' });
    await deactivate().expect(409); assert.equal((await account())?.status, 'ACTIVE');
  });

  it('allows past/checking-out-today, pending, cancelled, expired and other users bookings', async () => {
    await fixture.connection.collection('flightbookings').insertMany([
      { userId: new Types.ObjectId(owner.userId), status: 'CONFIRMED', lastDepartureAt: new Date(0) },
      { userId: new Types.ObjectId(stranger.userId), status: 'CONFIRMED', lastDepartureAt: new Date(Date.now() + 86_400_000) },
    ]);
    await fixture.connection.collection('hotelbookings').insertOne({ userId: new Types.ObjectId(owner.userId), status: 'CONFIRMED', checkOut: TODAY });
    for (const status of ['PENDING', 'CANCELLED', 'EXPIRED', 'COMPLETED'])
      await fixture.connection.collection('hotelbookings').insertOne({ userId: new Types.ObjectId(owner.userId), status, checkOut: '2035-02-01' });
    await deactivate().expect(204);
  });

  for (const kind of ['flight', 'hotel'] as const) it(`fails closed when the ${kind} eligibility query fails`, async (context) => {
    const target = kind === 'flight' ? fixture.app.get(FlightBookingsService) : fixture.app.get(HotelBookingsService);
    const probe = mock.method(target, 'hasUpcomingConfirmedBookings', async (_userId: string, session?: ClientSession) => {
      assert.ok(session?.inTransaction()); throw new Error('synthetic private lookup outage');
    }); context.after(() => probe.mock.restore());
    const denied = await deactivate().expect(500); assert.equal(denied.body.message, 'An unexpected error occurred');
    assert.equal(denied.headers['set-cookie'], undefined); assert.equal((await account())?.status, 'ACTIVE'); assert.equal((await account())?.bookingVersion, 0);
    await fixture.http().get('/api/auth/me').set('Cookie', owner.cookie).expect(200);
  });

  it('rolls back account/credential changes if session revocation fails', async (context) => {
    const sessions = fixture.app.get<Model<AuthSession>>(getModelToken(AuthSession.name));
    const probe = mock.method(sessions, 'updateMany', () => { throw new Error('synthetic revocation outage'); });
    context.after(() => probe.mock.restore());
    const result = await deactivate().expect(500); assert.equal(result.headers['set-cookie'], undefined);
    assert.equal((await account())?.status, 'ACTIVE'); assert.equal((await account())?.credentialVersion, 0); assert.equal((await account())?.bookingVersion, 0);
    await fixture.http().get('/api/auth/me').set('Cookie', owner.cookie).expect(200);
  });

  it('accepts a legacy missing booking version and fails closed on corrupt/exhausted counters', async () => {
    const collection = fixture.connection.collection('users'), id = new Types.ObjectId(owner.userId);
    for (const bookingVersion of ['bad', -1, 0.5, Number.MAX_SAFE_INTEGER]) {
      await collection.updateOne({ _id: id }, { $set: { bookingVersion } });
      await deactivate().expect(409); assert.equal((await account())?.status, 'ACTIVE');
    }
    await collection.updateOne({ _id: id }, { $unset: { bookingVersion: 1 } });
    await deactivate().expect(204); assert.equal((await account())?.bookingVersion, 1);
  });

  it('rejects a stale authenticated credential version instead of rebasing onto a password reset', async (context) => {
    const original = users.acquireBookingGate.bind(users); let injected = false;
    const probe = mock.method(users, 'acquireBookingGate', async (userId: string, session: ClientSession) => {
      if (!injected) { injected = true; await fixture.connection.collection('users').updateOne({ _id: new Types.ObjectId(userId) }, { $inc: { credentialVersion: 1 } }); }
      await original(userId, session);
    }); context.after(() => probe.mock.restore());
    await deactivate().expect(401); assert.equal((await account())?.status, 'ACTIVE'); assert.equal((await account())?.bookingVersion, 0);
  });

  it('keeps the booking counter private and leaves credential versions unchanged on confirmation/replay', async () => {
    const payment = await pendingPayment('flight'); await webhook(payment.intentId).expect(200);
    assert.equal((await account())?.bookingVersion, 1); assert.equal((await account())?.credentialVersion, 0);
    await webhook(payment.intentId).expect(200); assert.equal((await account())?.bookingVersion, 1);
    for (const path of ['/api/auth/me', '/api/users/me']) {
      const response = await fixture.http().get(path).set('Cookie', owner.cookie).expect(200);
      assert.equal(JSON.stringify(response.body).includes('bookingVersion'), false);
    }
  });

  for (const kind of ['flight', 'hotel'] as const) for (const winner of ['deactivation', 'confirmation'] as const)
    it(`serializes ${kind}: ${winner} wins the race`, { timeout: 40_000 }, async (context) => {
      const payment = await pendingPayment(kind), original = users.acquireBookingGate.bind(users);
      let lockedResolve!: () => void, contenderResolve!: () => void, release!: () => void;
      const locked = new Promise<void>(resolve => { lockedResolve = resolve; });
      const contender = new Promise<void>(resolve => { contenderResolve = resolve; });
      const barrier = new Promise<void>(resolve => { release = resolve; }); let calls = 0;
      const probe = mock.method(users, 'acquireBookingGate', async (userId: string, session: ClientSession) => {
        const call = ++calls; if (call === 2) contenderResolve();
        await original(userId, session);
        if (call === 1) { lockedResolve(); await barrier; }
      }); context.after(() => { release(); probe.mock.restore(); });
      const first = (winner === 'deactivation' ? deactivate() : webhook(payment.intentId)).then(response => response);
      await locked;
      const second = (winner === 'deactivation' ? webhook(payment.intentId) : deactivate()).then(response => response);
      await contender; release();
      const [a, b] = await Promise.all([first, second]);
      const deactivation = winner === 'deactivation' ? a : b, paid = winner === 'deactivation' ? b : a;
      assert.equal(paid.status, 200);
      if (winner === 'deactivation') {
        assert.equal(deactivation.status, 204); assert.equal((await account())?.status, 'DEACTIVATED');
        assert.equal((await booking(kind, payment.bookingId))?.status, 'PENDING'); assert.equal(stripe.calls.createRefund, 1);
      } else {
        assert.equal(deactivation.status, 409); assert.equal((await account())?.status, 'ACTIVE');
        assert.equal((await booking(kind, payment.bookingId))?.status, 'CONFIRMED'); assert.equal(stripe.calls.createRefund, 0);
      }
    });

  it('hides posts/public itineraries and anonymizes retained comments/reviews through the existing readers', async () => {
    const ownPost = await fixture.http().post('/api/posts').set('Cookie', owner.cookie).send({ title: 'Owner post', content: 'Owner travel story', status: 'PUBLISHED' }).expect(201);
    const otherPost = await fixture.http().post('/api/posts').set('Cookie', stranger.cookie).send({ title: 'Other post', content: 'Other travel story', status: 'PUBLISHED' }).expect(201);
    await fixture.http().post(`/api/posts/${otherPost.body.postId}/comments`).set('Cookie', owner.cookie).send({ content: 'Retained comment' }).expect(201);
    const itineraryId = new Types.ObjectId();
    await fixture.connection.collection('itineraries').insertOne({ _id: itineraryId, userId: new Types.ObjectId(owner.userId), title: 'Public itinerary', description: 'Travel plan', countries: ['EG'],
      startDate: new Date('2035-01-10'), currency: 'USD', days: [], transportCosts: [], visibility: 'PUBLIC', publishedAt: new Date(), createdAt: new Date(), updatedAt: new Date() });
    const { hotelId } = await hotelHold(); // PENDING stays do not block self-deactivation.
    await fixture.connection.collection('reviews').insertOne({ userId: new Types.ObjectId(owner.userId), hotelId, hotelBookingId: new Types.ObjectId(), rating: 5, comment: 'Retained review', isHidden: false, createdAt: new Date(), updatedAt: new Date() });
    await fixture.http().get(`/api/posts/${ownPost.body.postId}`).expect(200);
    await fixture.http().get(`/api/itineraries/public/${itineraryId}`).expect(200);
    await deactivate().expect(204);
    await fixture.http().get(`/api/posts/${ownPost.body.postId}`).expect(404);
    await fixture.http().get(`/api/authors/${owner.userId}`).expect(404);
    await fixture.http().get(`/api/itineraries/public/${itineraryId}`).expect(404);
    const comments = await fixture.http().get(`/api/posts/${otherPost.body.postId}/comments`).expect(200);
    assert.deepEqual(comments.body.items[0].author, { userId: null, name: 'Deleted user' });
    const reviews = await fixture.http().get(`/api/hotels/${hotelId}/reviews`).expect(200);
    assert.deepEqual(reviews.body.items[0].author, { userId: null, name: 'Deleted user' });
    assert.equal(await fixture.connection.collection('blogposts').countDocuments({ userId: new Types.ObjectId(owner.userId) }), 1);
    assert.ok(await fixture.connection.collection('itineraries').findOne({ _id: itineraryId }));
  });

  it('documents the deactivation endpoint and guards without exposing coordination fields', async () => {
    const doc = (await fixture.http().get('/api/docs-json').expect(200)).body;
    const route = doc.paths['/api/users/me/deactivate'].post; assert.match(route.summary, /ACC-12/);
    for (const status of [204, 400, 401, 403, 409]) assert.ok(route.responses[status]);
    assert.ok(route.security.some((entry: object) => 'accessToken' in entry));
    assert.deepEqual(Object.keys(doc.components.schemas.DeactivateAccountDto.properties), ['confirmed']);
  });
});