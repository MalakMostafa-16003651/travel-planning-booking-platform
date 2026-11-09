import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { ClientSession, Types } from 'mongoose';
import { EmailEligibilityService } from '../src/auth/email-eligibility.service';
import { RoomInventoryAdapter } from '../src/hotel-bookings/adapters/room-inventory.adapter';
import { HotelBookingsService } from '../src/hotel-bookings/hotel-bookings.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { StripeService } from '../src/payments/stripe.service';
import { FakeStripe, TEST_STRIPE_CONFIG } from './fake-stripe';
import { PaymentsFixture } from './payments-fixture';

describe('HTL-17 real hotel payment confirmation', { concurrency: false }, () => {
  const fixture = new PaymentsFixture();
  let stripe: FakeStripe;
  let owner: { userId: string; cookie: string };
  let bookingId: string;
  let roomIds: Types.ObjectId[];
  let service: HotelBookingsService;
  const bookings = () => fixture.connection.collection('hotelbookings');
  const payments = () => fixture.connection.collection('payments');
  const availability = () => fixture.connection.collection('roomavailabilities');
  const booking = () => bookings().findOne({ _id: new Types.ObjectId(bookingId) });
  const ranges = async () => (await availability().find({ roomId: { $in: roomIds } }).toArray()).flatMap(row => row.bookedRanges);
  const webhook = (type: string, intent: unknown) => {
    const event = FakeStripe.signedEvent(type, intent);
    return fixture.http().post('/api/payments/webhook').set('stripe-signature', event.signature)
      .set('Content-Type', 'application/json').send(event.payload);
  };
  async function startPayment() {
    await fixture.http().post(`/api/bookings/hotel/${bookingId}/accept-policies`).set('Cookie', owner.cookie).send({ accepted: true }).expect(200);
    const response = await fixture.http().post('/api/payments').set('Cookie', owner.cookie).send({ bookingType: 'hotel', bookingId }).expect(201);
    return { paymentId: response.body.payment._id as string, intentId: response.body.payment.stripePaymentIntentId as string };
  }
  async function markVerified(paymentId: string) {
    await payments().updateOne({ _id: new Types.ObjectId(paymentId) }, { $set: { status: 'SUCCEEDED' } });
  }
  before(async () => {
    await fixture.start('real-hotel-confirmation', undefined, TEST_STRIPE_CONFIG);
    service = fixture.app.get(HotelBookingsService);
  }, { timeout: 30 * 60_000 });
  after(() => fixture.stop());
  beforeEach(async () => {
    await fixture.reset();
    stripe = new FakeStripe(); stripe.install(fixture.app.get(StripeService));
    owner = await fixture.login('hotel-confirm@example.com');
    const hotelId = new Types.ObjectId();
    roomIds = [new Types.ObjectId(), new Types.ObjectId()];
    await fixture.connection.collection('hotels').insertOne({ _id: hotelId, name: 'Confirmation hotel', isActive: true,
      checkInTime: '14:00', checkOutTime: '12:00', cancellationTiers: [{ daysBeforeCheckIn: 1, refundPercentage: 100 }] });
    await fixture.connection.collection('rooms').insertMany(roomIds.map((_id, index) => ({ _id, hotelId, name: 'Room ' + index,
      capacity: 2, pricePerNight: 10000, isActive: true })));
    const hold = await fixture.http().post('/api/hotel-bookings').set('Cookie', owner.cookie).send({ hotelId: hotelId.toString(),
      checkIn: '2035-01-10', checkOut: '2035-01-12', rooms: roomIds.map(roomId => ({ roomId: roomId.toString(), adults: 1, childrenAges: [] })) }).expect(201);
    bookingId = hold.body.hotelBookingId;
  });

  it('confirms every real held room only after a signed success, with a stable reference and one notification on replay', async () => {
    const { paymentId, intentId } = await startPayment();
    await service.markPaymentFailed(bookingId, paymentId);
    assert.ok((await ranges()).every(row => row.status === 'HELD'));
    await assert.rejects(service.confirmPaidBooking(bookingId, paymentId), { status: 409 });
    await webhook('payment_intent.succeeded', stripe.succeed(intentId)).expect(200);
    const confirmed = await booking();
    assert.equal(confirmed?.status, 'CONFIRMED');
    assert.equal(confirmed?.paymentId.toString(), paymentId);
    assert.match(confirmed?.bookingReference, /^HTL-[A-F0-9]{16}$/);
    assert.equal(confirmed?.holdExpiresAt, undefined);
    assert.equal((await ranges()).length, 2);
    assert.ok((await ranges()).every(row => row.status === 'BOOKED' && row.holdExpiresAt === undefined));
    await webhook('payment_intent.succeeded', stripe.intent(intentId)).expect(200);
    assert.deepEqual(await booking(), confirmed);
    assert.equal(await fixture.connection.collection('notifications').countDocuments({ type: 'BOOKING_CONFIRMED' }), 1);
    const notification = await fixture.connection.collection('notifications').findOne({ type: 'BOOKING_CONFIRMED' });
    assert.ok(notification?.message.includes(confirmed?.bookingReference));
    assert.match(notification?.message, /Confirmation hotel.*2035-01-10.*2035-01-12.*2 rooms.*400.00 USD/);
    assert.equal(stripe.calls.createRefund, 0);
    await assert.rejects(service.confirmPaidBooking(bookingId, new Types.ObjectId().toString()), { status: 409 });
    await fixture.http().get(`/api/hotel-bookings/${bookingId}`).set('Cookie', owner.cookie).expect(200);
  });

  it('rejects nonexistent, wrong-owner, wrong-reservation, wrong-amount and wrong-currency payment records without changing holds', async () => {
    const { paymentId } = await startPayment(); await markVerified(paymentId);
    const id = new Types.ObjectId(paymentId);
    const original = (await payments().findOne({ _id: id }))!;
    await assert.rejects(service.confirmPaidBooking(bookingId, new Types.ObjectId().toString()), { status: 409 });
    for (const patch of [{ userId: new Types.ObjectId() }, { hotelBookingId: new Types.ObjectId() }, { amount: 1 }, { currency: 'EGP' }]) {
      await payments().replaceOne({ _id: id }, { ...original, ...patch });
      await assert.rejects(service.confirmPaidBooking(bookingId, paymentId), { status: 409 });
    }
    assert.equal((await booking())?.status, 'PENDING');
    assert.ok((await ranges()).every(row => row.status === 'HELD'));
  });

  it('rolls back all room conversions when another room hold is missing, then refunds the signed success', async () => {
    const { intentId } = await startPayment();
    await availability().updateOne({ roomId: roomIds[1] }, { $set: { bookedRanges: [] } });
    await webhook('payment_intent.succeeded', stripe.succeed(intentId)).expect(200);
    assert.equal((await booking())?.status, 'PENDING');
    assert.equal((await booking())?.bookingReference, undefined);
    assert.equal((await ranges())[0].status, 'HELD');
    assert.equal(stripe.calls.createRefund, 1);
  });

  it('refunds late success after hold expiry and never restores expired inventory', async () => {
    const { intentId } = await startPayment();
    await bookings().updateOne({ _id: new Types.ObjectId(bookingId) }, { $set: { holdExpiresAt: new Date(0) } });
    await service.expireOverdueHolds();
    await webhook('payment_intent.succeeded', stripe.succeed(intentId)).expect(200);
    assert.equal((await booking())?.status, 'EXPIRED');
    assert.equal((await ranges()).length, 0);
    assert.equal(stripe.calls.createRefund, 1);
  });

  it('serializes concurrent confirmation replays into one booking and notification', async () => {
    const { paymentId } = await startPayment(); await markVerified(paymentId);
    await Promise.all([service.confirmPaidBooking(bookingId, paymentId), service.confirmPaidBooking(bookingId, paymentId)]);
    assert.equal((await booking())?.status, 'CONFIRMED');
    assert.ok((await ranges()).every(row => row.status === 'BOOKED'));
    assert.equal(await fixture.connection.collection('notifications').countDocuments({ type: 'BOOKING_CONFIRMED' }), 1);
  });

  for (const status of ['SUSPENDED', 'DEACTIVATED']) it(`refunds success when the owner is already ${status}`, async () => {
    const { intentId } = await startPayment();
    await fixture.users.updateOne({ _id: owner.userId }, { $set: { status } });
    await webhook('payment_intent.succeeded', stripe.succeed(intentId)).expect(200);
    assert.equal((await booking())?.status, 'PENDING');
    assert.ok((await ranges()).every(row => row.status === 'HELD'));
    assert.equal(stripe.calls.createRefund, 1);
  });

  it('checks email eligibility inside the real confirmation transaction and propagates lookup outages', async (context) => {
    const { paymentId } = await startPayment(); await markVerified(paymentId);
    const eligibility = fixture.app.get(EmailEligibilityService);
    let mode = 'outage';
    const probe = mock.method(eligibility, 'canBook', async (_userId: string, session?: ClientSession) => {
      assert.ok(session); if (mode === 'outage') throw new Error('synthetic lookup failure'); return mode === 'allowed';
    });
    context.after(() => probe.mock.restore());
    await assert.rejects(service.confirmPaidBooking(bookingId, paymentId), /synthetic lookup failure/);
    mode = 'ineligible';
    await assert.rejects(service.confirmPaidBooking(bookingId, paymentId), { status: 409 });
    assert.ok((await ranges()).every(row => row.status === 'HELD'));
    mode = 'allowed'; await service.confirmPaidBooking(bookingId, paymentId);
    assert.equal((await booking())?.status, 'CONFIRMED');
  });

  it('rejects inactive providers, inactive rooms and newly blocked dates without partial conversion', async () => {
    const { paymentId } = await startPayment(); await markVerified(paymentId);
    const held = (await booking())!;
    const hotels = fixture.connection.collection('hotels');
    const rooms = fixture.connection.collection('rooms');
    await hotels.updateOne({ _id: held.hotelId }, { $set: { isActive: false } });
    await assert.rejects(service.confirmPaidBooking(bookingId, paymentId), { status: 409 });
    await hotels.updateOne({ _id: held.hotelId }, { $set: { isActive: true } });
    await rooms.updateOne({ _id: roomIds[1] }, { $set: { isActive: false } });
    await assert.rejects(service.confirmPaidBooking(bookingId, paymentId), { status: 409 });
    await rooms.updateOne({ _id: roomIds[1] }, { $set: { isActive: true } });
    await availability().updateOne({ roomId: roomIds[1] }, { $set: { blockedRanges: [{ startDate: '2035-01-10', endDate: '2035-01-11' }] } });
    await assert.rejects(service.confirmPaidBooking(bookingId, paymentId), { status: 409 });
    assert.equal((await booking())?.status, 'PENDING');
    assert.ok((await ranges()).every(row => row.status === 'HELD'));
  });

  it('preserves historical replay after completion and later account deactivation', async () => {
    const { paymentId, intentId } = await startPayment();
    await webhook('payment_intent.succeeded', stripe.succeed(intentId)).expect(200);
    await bookings().updateOne({ _id: new Types.ObjectId(bookingId) }, { $set: { status: 'COMPLETED' } });
    await fixture.users.updateOne({ _id: owner.userId }, { $set: { status: 'DEACTIVATED' } });
    const completed = await booking();
    await service.confirmPaidBooking(bookingId, paymentId);
    assert.deepEqual(await booking(), completed);
    assert.equal(await fixture.connection.collection('notifications').countDocuments({ type: 'BOOKING_CONFIRMED' }), 1);
  });

  it('keeps booking status and all room ranges consistent when confirmation races an expiry sweep', async () => {
    const { paymentId } = await startPayment(); await markVerified(paymentId);
    // A due sweep and a confirmation compete for the same booking/availability documents.
    const sweepTime = new Date(Date.now() + 11 * 60 * 1000);
    const outcomes = await Promise.allSettled([service.confirmPaidBooking(bookingId, paymentId), service.expireOverdueHolds(sweepTime)]);
    const final = await booking();
    if (final?.status === 'CONFIRMED') {
      assert.equal(outcomes[0].status, 'fulfilled');
      assert.equal((await ranges()).length, 2);
      assert.ok((await ranges()).every(row => row.status === 'BOOKED'));
    } else {
      assert.equal(final?.status, 'EXPIRED');
      assert.equal(outcomes[0].status, 'rejected');
      assert.equal((await ranges()).length, 0);
    }
  });
  it('does not undo a committed booking when notification delivery fails', async (context) => {
    const probe = mock.method(fixture.app.get(NotificationsService), 'notify', async () => { throw new Error('synthetic notification outage'); });
    context.after(() => probe.mock.restore());
    const { intentId } = await startPayment();
    await webhook('payment_intent.succeeded', stripe.succeed(intentId)).expect(200);
    await webhook('payment_intent.succeeded', stripe.intent(intentId)).expect(200);
    assert.equal((await booking())?.status, 'CONFIRMED');
    assert.equal(probe.mock.callCount(), 1);
    assert.equal(stripe.calls.createRefund, 0);
  });

  it('keeps the pending reservation retryable after a signed decline using the real no-op failure hook', async () => {
    const { paymentId, intentId } = await startPayment();
    await webhook('payment_intent.payment_failed', stripe.decline(intentId)).expect(200);
    assert.equal((await booking())?.status, 'PENDING');
    assert.ok((await ranges()).every(row => row.status === 'HELD'));
    const retry = await fixture.http().post(`/api/payments/${paymentId}/retry`).set('Cookie', owner.cookie).expect(200);
    await webhook('payment_intent.succeeded', stripe.succeed(retry.body.payment.stripePaymentIntentId)).expect(200);
    assert.equal((await booking())?.status, 'CONFIRMED');
  });
});