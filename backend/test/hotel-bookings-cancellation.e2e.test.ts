import { configureTestBookableRoom } from './hotel-test-data';
import { PaymentsService } from '../src/payments/payments.service';
import { PaymentDocument } from '../src/payments/schemas/payment.schema';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { Types } from 'mongoose';
import { UserRole } from '../src/common/enums/user-role.enum';
import { RoomInventoryAdapter } from '../src/hotel-bookings/adapters/room-inventory.adapter';
import { HotelBookingsClock } from '../src/hotel-bookings/hotel-booking.dates';
import { HotelBookingsMaintenanceService } from '../src/hotel-bookings/hotel-bookings-maintenance.service';
import { HotelBookingsService } from '../src/hotel-bookings/hotel-bookings.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { StripeService } from '../src/payments/stripe.service';
import { FakeStripe, TEST_STRIPE_CONFIG } from './fake-stripe';
import { PaymentsFixture } from './payments-fixture';

const TODAY = '2035-01-03';
const CHECK_IN = '2035-01-10';

describe('HTL-21 whole hotel cancellation and refunds', { concurrency: false }, () => {
  const fixture = new PaymentsFixture();
  let stripe: FakeStripe;
  let owner: { cookie: string; userId: string };
  let stranger: { cookie: string; userId: string };
  let bookingId: string;
  let hotelId: Types.ObjectId;
  let roomIds: Types.ObjectId[];
  let intentId: string;
  let service: HotelBookingsService;
  let clock: HotelBookingsClock;
  const bookings = () => fixture.connection.collection('hotelbookings');
  const availability = () => fixture.connection.collection<{ roomId: Types.ObjectId; bookedRanges: { hotelBookingId: Types.ObjectId; status: string; startDate: string; endDate: string }[] }>('roomavailabilities');
  const stored = () => bookings().findOne({ _id: new Types.ObjectId(bookingId) });
  const ranges = async () => (await availability().find({ roomId: { $in: roomIds } }).toArray()).flatMap(row => row.bookedRanges);
  const quote = (session = owner, id = bookingId) => fixture.http().get(`/api/hotel-bookings/${id}/cancellation-quote`).set('Cookie', session.cookie);
  const cancel = (token: string, session = owner, extra: object = {}) => fixture.http().post(`/api/hotel-bookings/${bookingId}/cancel`)
    .set('Cookie', session.cookie).send({ confirmed: true, quoteToken: token, ...extra });
  const detail = () => fixture.http().get(`/api/hotel-bookings/${bookingId}`).set('Cookie', owner.cookie);

  before(async () => {
    await fixture.start('hotel-cancellation', undefined, TEST_STRIPE_CONFIG);
    service = fixture.app.get(HotelBookingsService); clock = fixture.app.get(HotelBookingsClock);
  }, { timeout: 30 * 60_000 });
  after(() => fixture.stop());
  beforeEach(async () => {
    await fixture.reset(); clock.today = () => TODAY;
    stripe = new FakeStripe(); stripe.install(fixture.app.get(StripeService));
    owner = await fixture.login('cancel-owner@example.com'); stranger = await fixture.login('cancel-stranger@example.com');
    hotelId = new Types.ObjectId(); roomIds = [new Types.ObjectId(), new Types.ObjectId()];
    await fixture.connection.collection('hotels').insertOne({ _id: hotelId, name: 'Cancellation hotel', isActive: true,
      checkInTime: '14:00', checkOutTime: '12:00', cancellationTiers: [
        { daysBeforeCheckIn: 1, refundPercentage: 25 }, { daysBeforeCheckIn: 7, refundPercentage: 100 }, { daysBeforeCheckIn: 2, refundPercentage: 50 },
      ] });
    await fixture.connection.collection('rooms').insertMany(roomIds.map((_id, i) => ({ _id, hotelId, name: 'Room ' + i, capacity: 2, pricePerNight: 10000, isActive: true })));
    for (const roomId of roomIds) await configureTestBookableRoom(fixture.connection,roomId,hotelId);
    const hold = await fixture.http().post('/api/hotel-bookings').set('Cookie', owner.cookie).send({ hotelId: hotelId.toString(),
      checkIn: CHECK_IN, checkOut: '2035-01-12', rooms: roomIds.map(id => ({ roomId: id.toString(), adults: 1, childrenAges: [] })) }).expect(201);
    bookingId = hold.body.hotelBookingId;
    await fixture.http().post(`/api/bookings/hotel/${bookingId}/accept-policies`).set('Cookie', owner.cookie).send({ accepted: true }).expect(200);
    const payment = await fixture.http().post('/api/payments').set('Cookie', owner.cookie).send({ bookingType: 'hotel', bookingId }).expect(201);
    intentId = payment.body.payment.stripePaymentIntentId;
    const event = FakeStripe.signedEvent('payment_intent.succeeded', stripe.succeed(intentId));
    await fixture.http().post('/api/payments/webhook').set('stripe-signature', event.signature).set('Content-Type', 'application/json').send(event.payload).expect(200);
  });

  it('quotes the full frozen total and snapshot policy at UTC tier boundaries without mutations', async () => {
    const before = await stored();
    await fixture.connection.collection('hotels').updateOne({ _id: hotelId }, { $set: { cancellationTiers: [] } });
    for (const [day, days, percent] of [[TODAY, 7, 100], ['2035-01-04', 6, 50], ['2035-01-08', 2, 50], ['2035-01-09', 1, 25]] as const) {
      clock.today = () => day;
      const response = await quote().expect(200);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.deepEqual([response.body.totalPrice, response.body.currency, response.body.daysBeforeCheckIn,
        response.body.refundPercentage, response.body.refundAmount], [40000, 'USD', days, percent, 40000 * percent / 100]);
      assert.match(response.body.quoteToken, /^\d{13}\.[a-f\d]{64}$/);
    }
    assert.deepEqual(await stored(), before);
    assert.ok((await ranges()).every(range => range.status === 'BOOKED'));
    assert.equal(stripe.calls.createRefund, 0);
  });

  it('cancels every room, preserves other bookings, refunds once and reads authoritative completion', async () => {
    const unrelated = new Types.ObjectId();
    await availability().updateOne({ roomId: roomIds[0] }, { $push: { bookedRanges: { hotelBookingId: unrelated, status: 'BOOKED', startDate: '2035-02-01', endDate: '2035-02-02' } } });
    const token = (await quote().expect(200)).body.quoteToken;
    const result = await cancel(token).expect(200);
    assert.equal(result.body.status, 'CANCELLED');
    assert.equal(result.body.cancelledBy, 'USER');
    assert.equal(result.body.refundAmount, 40000);
    assert.equal(result.body.refundStatus, 'PENDING');
    assert.ok(result.body.refundId); assert.ok(result.body.cancelledAt);
    const remaining = await ranges(); assert.equal(remaining.length, 1); assert.equal(remaining[0].hotelBookingId.toString(), unrelated.toString());
    assert.equal(stripe.calls.createRefund, 1);
    const refund = await fixture.connection.collection('refunds').findOne({ hotelBookingId: new Types.ObjectId(bookingId) });
    assert.equal(refund?.amount, 400);
    stripe.setRefundStatus(refund!.stripeRefundId, 'succeeded');
    assert.equal((await detail().expect(200)).body.refundStatus, 'REFUNDED');
    assert.equal(await fixture.connection.collection('notifications').countDocuments({ type: 'BOOKING_CANCELLED' }), 1);
    await cancel(token).expect(409);
    assert.equal(stripe.calls.createRefund, 1);
  });

  it('waits for payment confirmation finalization before allowing cancellation', async () => {
    const token = (await quote().expect(200)).body.quoteToken;
    const payments = fixture.connection.collection('payments');
    await payments.updateOne({ hotelBookingId: new Types.ObjectId(bookingId) }, { $unset: { bookingConfirmedAt: 1 } });
    await cancel(token).expect(409);
    assert.equal((await stored())?.status, 'CONFIRMED');
    assert.equal((await ranges()).length, 2); assert.equal(stripe.calls.createRefund, 0);
    await payments.updateOne({ hotelBookingId: new Types.ObjectId(bookingId) }, { $set: { bookingConfirmedAt: new Date() } });
    await cancel(token).expect(200);
  });
  it('does not turn a pending cancellation refund into a full automatic refund through a stale webhook', { timeout: 30_000 }, async (context) => {
    clock.today = () => '2035-01-08';
    const payments = fixture.connection.collection('payments');
    await payments.updateOne({ hotelBookingId: new Types.ObjectId(bookingId) }, { $unset: { bookingConfirmedAt: 1 } });
    const state = fixture.app.get(PaymentsService) as unknown as { confirmIfStillPayable(payment: PaymentDocument): Promise<boolean> };
    const original = state.confirmIfStillPayable.bind(state);
    let enteredResolve!: () => void, releaseRead!: () => void;
    const entered = new Promise<void>(resolve => { enteredResolve = resolve; });
    const barrier = new Promise<void>(resolve => { releaseRead = resolve; });
    let delayed = false;
    const probe = mock.method(state, 'confirmIfStillPayable', async (payment: PaymentDocument) => {
      if (!delayed) { delayed = true; enteredResolve(); await barrier; }
      return original(payment);
    });
    context.after(() => { releaseRead(); probe.mock.restore(); });
    const send = () => {
      const event = FakeStripe.signedEvent('payment_intent.succeeded', stripe.intent(intentId));
      return fixture.http().post('/api/payments/webhook').set('stripe-signature', event.signature).set('Content-Type', 'application/json').send(event.payload);
    };
    const late = send().then(response => response);
    await entered;
    try {
      await send().expect(200); // Another delivery finishes confirmation while the first is delayed.
      stripe.failNextRefund = true;
      await cancel((await quote().expect(200)).body.quoteToken).expect(200);
    } finally { releaseRead(); }
    assert.equal((await late).status, 200);
    assert.equal(stripe.calls.createRefund, 0);
    assert.equal((await payments.findOne({ hotelBookingId: new Types.ObjectId(bookingId) }))?.autoRefundedAt, undefined);
    await service.retryDueRefunds();
    assert.equal(stripe.calls.createRefund, 1);
    assert.equal([...stripe.refunds.values()][0].amount, 20000);
  });
  it('uses a partial refund percentage on the entire reservation, never just one room', async () => {
    clock.today = () => '2035-01-08';
    const result = await cancel((await quote().expect(200)).body.quoteToken).expect(200);
    assert.equal(result.body.refundAmount, 20000);
    assert.equal((await ranges()).length, 0);
    assert.equal([...stripe.refunds.values()][0].amount, 20000);
  });

  it('allows a zero-refund cancellation without making a Stripe refund request', async () => {
    await bookings().updateOne({ _id: new Types.ObjectId(bookingId) }, { $set: { 'policySnapshot.cancellationTiers': [] } });
    const result = await cancel((await quote().expect(200)).body.quoteToken).expect(200);
    assert.equal(result.body.refundAmount, 0); assert.equal(result.body.refundStatus, undefined);
    assert.equal((await ranges()).length, 0); assert.equal(stripe.calls.createRefund, 0);
    assert.equal((await stored())?.refundDue, false);
  });

  it('enforces ownership, roles, real cookies, valid IDs and cross-origin write rejection', async () => {
    const token = (await quote().expect(200)).body.quoteToken;
    await quote(stranger).expect(404); await cancel(token, stranger).expect(404);
    await quote(owner, new Types.ObjectId().toString()).expect(404); await quote(owner, 'invalid').expect(400);
    await fixture.http().get(`/api/hotel-bookings/${bookingId}/cancellation-quote`).expect(401);
    await fixture.http().post(`/api/hotel-bookings/${bookingId}/cancel`).send({ confirmed: true, quoteToken: token }).expect(401);
    const admin = await fixture.login('cancel-admin@example.com', UserRole.ADMIN);
    await quote(admin).expect(403); await cancel(token, admin).expect(403);
    await fixture.http().post(`/api/hotel-bookings/${bookingId}/cancel`).set('Cookie', owner.cookie)
      .set('Origin', 'https://untrusted.example').send({ confirmed: true, quoteToken: token }).expect(403);
    assert.equal((await stored())?.status, 'CONFIRMED'); assert.equal(stripe.calls.createRefund, 0);
  });

  it('requires explicit confirmation and refuses partial-cancellation or refund-amount input', async () => {
    const token = (await quote().expect(200)).body.quoteToken;
    for (const body of [{}, { confirmed: true }, { quoteToken: token }, { confirmed: false, quoteToken: token },
      { confirmed: 'true', quoteToken: token }, { confirmed: true, quoteToken: token, roomIds: [roomIds[0].toString()] },
      { confirmed: true, quoteToken: token, refundAmount: 1 }]) {
      await fixture.http().post(`/api/hotel-bookings/${bookingId}/cancel`).set('Cookie', owner.cookie).send(body).expect(400);
    }
    assert.equal((await stored())?.status, 'CONFIRMED'); assert.ok((await ranges()).every(row => row.status === 'BOOKED'));
  });

  it('rejects forged, expired and changed-snapshot quotes', async (context) => {
    const token: string = (await quote().expect(200)).body.quoteToken;
    const replacement = token.endsWith('0') ? '1' : '0';
    await cancel(token.slice(0, -1) + replacement).expect(409);
    await bookings().updateOne({ _id: new Types.ObjectId(bookingId) }, { $set: { 'policySnapshot.cancellationTiers': [] } });
    await cancel(token).expect(409);
    const fresh = (await quote().expect(200)).body.quoteToken;
    const now = Date.now(); const probe = mock.method(Date, 'now', () => now + 6 * 60_000);
    context.after(() => probe.mock.restore());
    await cancel(fresh).expect(409);
    assert.equal((await stored())?.status, 'CONFIRMED');
  });

  it('requires a new quote after a UTC tier change and refuses cancellation on or after check-in', async () => {
    const token = (await quote().expect(200)).body.quoteToken;
    clock.today = () => '2035-01-04'; await cancel(token).expect(409);
    for (const day of [CHECK_IN, '2035-01-11']) {
      clock.today = () => day; await quote().expect(409); await cancel(token).expect(409);
    }
    assert.equal((await stored())?.status, 'CONFIRMED');
  });

  it('refuses pending, completed, expired and already-cancelled reservations', async () => {
    const token = (await quote().expect(200)).body.quoteToken;
    for (const status of ['PENDING', 'COMPLETED', 'EXPIRED', 'CANCELLED']) {
      await bookings().updateOne({ _id: new Types.ObjectId(bookingId) }, { $set: { status } });
      await quote().expect(409); await cancel(token).expect(409);
    }
    assert.equal(stripe.calls.createRefund, 0);
  });

  it('serializes concurrent cancellation so inventory, refunds and notifications change once', async () => {
    const token = (await quote().expect(200)).body.quoteToken;
    const results = await Promise.all([cancel(token), cancel(token)]);
    assert.deepEqual(results.map(response => response.status).sort(), [200, 409]);
    assert.equal((await ranges()).length, 0);
    assert.equal(stripe.calls.createRefund, 1);
    assert.equal(await fixture.connection.collection('notifications').countDocuments({ type: 'BOOKING_CANCELLED' }), 1);
  });

  it('aborts cancellation and every room release when inventory persistence fails', async (context) => {
    const token = (await quote().expect(200)).body.quoteToken;
    const adapter = fixture.app.get(RoomInventoryAdapter), original = adapter.releaseBookedRooms.bind(adapter);
    const probe = mock.method(adapter, 'releaseBookedRooms', async (...args: Parameters<typeof original>) => { await original(...args); throw new Error('synthetic persistence failure'); });
    context.after(() => probe.mock.restore());
    const result = await cancel(token).expect(500); assert.equal(result.body.message, 'An unexpected error occurred');
    assert.equal((await stored())?.status, 'CONFIRMED'); assert.equal((await ranges()).length, 2);
    assert.ok((await ranges()).every(row => row.status === 'BOOKED')); assert.equal(stripe.calls.createRefund, 0);
  });

  it('rechecks UTC eligibility after a delayed inventory write and rolls back across check-in', async (context) => {
    const token = (await quote().expect(200)).body.quoteToken;
    const adapter = fixture.app.get(RoomInventoryAdapter), original = adapter.releaseBookedRooms.bind(adapter);
    const probe = mock.method(adapter, 'releaseBookedRooms', async (...args: Parameters<typeof original>) => { await original(...args); clock.today = () => CHECK_IN; });
    context.after(() => probe.mock.restore());
    await cancel(token).expect(409);
    assert.equal((await stored())?.status, 'CONFIRMED'); assert.equal((await ranges()).length, 2);
    assert.equal(stripe.calls.createRefund, 0);
  });

  it('keeps rooms released and refund pending during an outage, then the maintenance sweep retries', async () => {
    stripe.failNextRefund = true;
    const result = await cancel((await quote().expect(200)).body.quoteToken).expect(200);
    assert.equal(result.body.status, 'CANCELLED'); assert.equal(result.body.refundStatus, 'PENDING');
    assert.equal((await stored())?.refundDue, true); assert.equal((await ranges()).length, 0);
    await fixture.app.get(HotelBookingsMaintenanceService).sweep();
    assert.equal((await stored())?.refundDue, false); assert.ok((await stored())?.refundId);
    await service.retryDueRefunds(); assert.equal(stripe.calls.createRefund, 1);
  });

  it('recovers a lost Stripe refund response without issuing another refund', async () => {
    stripe.loseNextRefundResponse = true;
    await cancel((await quote().expect(200)).body.quoteToken).expect(200);
    assert.equal(stripe.calls.createRefund, 1); assert.equal((await stored())?.refundDue, true);
    await service.retryDueRefunds();
    assert.equal(stripe.calls.createRefund, 1); assert.equal((await stored())?.refundDue, false);
    assert.equal(await fixture.connection.collection('refunds').countDocuments(), 1);
  });

  it('reports FAILED from the authoritative refund record without undoing cancellation', async () => {
    await cancel((await quote().expect(200)).body.quoteToken).expect(200);
    const refund = await fixture.connection.collection('refunds').findOne({});
    stripe.setRefundStatus(refund!.stripeRefundId, 'failed');
    assert.equal((await detail().expect(200)).body.refundStatus, 'FAILED');
    assert.equal((await stored())?.status, 'CANCELLED'); assert.equal((await ranges()).length, 0);
  });

  it('does not undo cancellation or refund when the cancellation notification fails', async (context) => {
    const probe = mock.method(fixture.app.get(NotificationsService), 'notify', async () => { throw new Error('synthetic notification outage'); });
    context.after(() => probe.mock.restore());
    await cancel((await quote().expect(200)).body.quoteToken).expect(200);
    assert.equal((await stored())?.status, 'CANCELLED'); assert.equal(stripe.calls.createRefund, 1);
  });

  it('documents quote, confirmation, ownership errors and the authoritative refund status in Swagger', async () => {
    const doc = (await fixture.http().get('/api/docs-json').expect(200)).body;
    for (const [path, method] of [['/api/hotel-bookings/{id}/cancellation-quote', 'get'], ['/api/hotel-bookings/{id}/cancel', 'post']]) {
      const operation = doc.paths[path][method]; assert.match(operation.summary, /HTL-21/);
      for (const code of [200, 400, 401, 403, 404, 409]) assert.ok(operation.responses[code]);
      assert.ok(operation.security.some((entry: object) => 'accessToken' in entry));
    }
    assert.ok(doc.components.schemas.CancelHotelBookingDto); assert.ok(doc.components.schemas.HotelBookingDto.properties.refundStatus);
  });
});