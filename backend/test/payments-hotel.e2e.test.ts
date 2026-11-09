import { ConflictException } from '@nestjs/common';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { HotelBookingsService } from '../src/hotel-bookings/hotel-bookings.service';
import { BookingPaymentsAdapter } from '../src/payments/adapters/booking-payments.adapter';
import { HOLD_EXPIRED_REASON } from '../src/payments/payments.service';
import { StripeService } from '../src/payments/stripe.service';
import { FakeStripe, TEST_STRIPE_CONFIG } from './fake-stripe';
import { PaymentsFixture } from './payments-fixture';

type Session = { cookie: string; userId: string };

const TOTAL = 45050; // 450.50 USD in the hotel module's minor units.

/**
 * PAY-01/02/03 for hotel reservations, through the real Auth, HotelBookings and Payments modules on an
 * in-memory replica set. Person 6's confirmPaidBooking/markPaymentFailed (HTL-17) are simulated on the
 * service instance with the agreed behaviour, so this suite works before and after his PR.
 */
describe('PAY-01/02/03 hotel reservation payments', { concurrency: false }, () => {
  const fixture = new PaymentsFixture();
  let stripe: FakeStripe;
  let owner: Session;
  let stranger: Session;
  let bookingId: string;
  let failedCalls: string[][];

  const hotelBookings = () => fixture.connection.collection('hotelbookings');
  const payments = () => fixture.connection.collection('payments');
  const refunds = () => fixture.connection.collection('refunds');
  const reservation = () => hotelBookings().findOne({ _id: new Types.ObjectId(bookingId) });

  const accept = (session = owner) =>
    fixture.http().post(`/api/bookings/hotel/${bookingId}/accept-policies`).set('Cookie', session.cookie).send({ accepted: true });
  const pay = (session = owner) =>
    fixture.http().post('/api/payments').set('Cookie', session.cookie).send({ bookingType: 'hotel', bookingId });
  const webhook = (type: string, object: unknown) => {
    const { payload, signature } = FakeStripe.signedEvent(type, object);
    return fixture.http().post('/api/payments/webhook').set('stripe-signature', signature).set('Content-Type', 'application/json').send(payload);
  };

  async function startPayment() {
    await accept().expect(200);
    const response = await pay().expect(201);
    return { paymentId: response.body.payment._id as string, intentId: response.body.payment.stripePaymentIntentId as string };
  }

  /** A PENDING reservation exactly as Person 6's hold (HTL-16/18) stores it. */
  async function insertReservation(userId: string) {
    const _id = new Types.ObjectId();
    await hotelBookings().insertOne({
      _id,
      userId: new Types.ObjectId(userId),
      hotelId: new Types.ObjectId(),
      hotelName: 'Nile View',
      rooms: [{ roomId: new Types.ObjectId(), roomName: 'Double', pricePerNight: 22525, adults: 2, childrenAges: [], subtotal: TOTAL }],
      checkIn: '2027-01-10',
      checkOut: '2027-01-12',
      nights: 2,
      totalPrice: TOTAL,
      currency: 'USD',
      status: 'PENDING',
      holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      policySnapshot: {
        cancellationTiers: [{ daysBeforeCheckIn: 7, refundPercentage: 100 }, { daysBeforeCheckIn: 1, refundPercentage: 50 }],
        checkInTime: '14:00',
        checkOutTime: '12:00',
      },
      refundDue: false,
    });
    return _id.toString();
  }

  /** The agreed HTL-17 behaviour: conditional on PENDING and an unexpired hold, safe to repeat, 409 otherwise. */
  function simulatePersonSixHooks() {
    const service = fixture.app.get(HotelBookingsService, { strict: false }) as unknown as Record<string, unknown>;
    failedCalls = [];
    service.confirmPaidBooking = async (hotelBookingId: string, paymentId: string) => {
      const _id = new Types.ObjectId(hotelBookingId);
      const confirmed = await hotelBookings().findOneAndUpdate(
        { _id, status: 'PENDING', holdExpiresAt: { $gt: new Date() } },
        { $set: { status: 'CONFIRMED', paymentId: new Types.ObjectId(paymentId), bookingReference: `HTL-${hotelBookingId.slice(-6)}` }, $unset: { holdExpiresAt: 1 } },
      );
      if (confirmed) return;
      const current = await hotelBookings().findOne({ _id });
      if (current?.status === 'CONFIRMED' && current.paymentId?.toString() === paymentId) return;
      throw new ConflictException('The hold has ended');
    };
    service.markPaymentFailed = async (...args: string[]) => {
      failedCalls.push(args);
    };
  }

  before(async () => {
    await fixture.start('payments-hotel', undefined, TEST_STRIPE_CONFIG);
  }, { timeout: 30 * 60_000 });

  after(() => fixture.stop());

  beforeEach(async () => {
    await fixture.reset();
    stripe = new FakeStripe();
    stripe.install(fixture.app.get(StripeService));
    simulatePersonSixHooks();
    owner = await fixture.login('owner@example.com');
    stranger = await fixture.login('stranger@example.com');
    bookingId = await insertReservation(owner.userId);
  });

  it('PAY-02 shows the hotel cancellation tiers, check-in/out times and amount to the owner only', async () => {
    const response = await fixture.http().get(`/api/bookings/hotel/${bookingId}/policies`).set('Cookie', owner.cookie).expect(200);
    assert.deepEqual(response.body, {
      bookingType: 'hotel',
      bookingId,
      amount: 450.5,
      currency: 'USD',
      policies: {
        cancellation: { tiers: [{ daysBeforeCheckIn: 7, refundPercentage: 100 }, { daysBeforeCheckIn: 1, refundPercentage: 50 }] },
        checkInOut: { checkInTime: '14:00', checkOutTime: '12:00' },
      },
    });
    await fixture.http().get(`/api/bookings/hotel/${bookingId}/policies`).set('Cookie', stranger.cookie).expect(404);
    await accept(stranger).expect(404);
    await pay(stranger).expect(404);
    // Payment is blocked until the policies are accepted.
    await pay().expect(409);
    await accept().expect(200);
    const acceptance = await fixture.connection.collection('policyacceptances').findOne({});
    assert.equal(acceptance?.hotelBookingId.toString(), bookingId);
    assert.ok(acceptance?.acceptedAt instanceof Date);
  });

  it('PAY-01 blocks hotel checkout without the real confirmation connection before creating any payment', async () => {
    const service = fixture.app.get(HotelBookingsService, { strict: false }) as unknown as Record<string, unknown>;
    delete service.confirmPaidBooking;
    delete service.markPaymentFailed;
    await fixture.http().get(`/api/bookings/hotel/${bookingId}/policies`).set('Cookie', owner.cookie).expect(200);
    await accept().expect(200);
    await pay(stranger).expect(404);
    const before = await reservation();
    const blocked = await pay().expect(503);
    assert.equal(blocked.body.message, 'Hotel checkout is temporarily unavailable');
    assert.equal(stripe.calls.createIntent, 0);
    assert.equal(await payments().countDocuments(), 0);
    assert.equal(await refunds().countDocuments(), 0);
    assert.deepEqual(await reservation(), before);
  });

  it('PAY-01 blocks retry when hotel confirmation becomes unavailable, preserving the old payment and intent', async () => {
    const { paymentId, intentId } = await startPayment();
    await webhook('payment_intent.payment_failed', stripe.decline(intentId)).expect(200);
    const before = await payments().findOne({ _id: new Types.ObjectId(paymentId) });
    const oldIntent = structuredClone(stripe.intent(intentId));
    const service = fixture.app.get(HotelBookingsService, { strict: false }) as unknown as Record<string, unknown>;
    delete service.markPaymentFailed;
    await fixture.http().post(`/api/payments/${paymentId}/retry`).set('Cookie', owner.cookie).expect(503);
    assert.equal(stripe.calls.createIntent, 1);
    assert.deepEqual(stripe.intent(intentId), oldIntent);
    assert.deepEqual(await payments().findOne({ _id: new Types.ObjectId(paymentId) }), before);
    await fixture.http().get(`/api/payments/${paymentId}`).set('Cookie', owner.cookie).expect(200);
  });

  it('PAY-01 still refunds an existing signed success if the hotel confirmation connection disappears', async () => {
    const { paymentId, intentId } = await startPayment();
    const service = fixture.app.get(HotelBookingsService, { strict: false }) as unknown as Record<string, unknown>;
    delete service.confirmPaidBooking;
    const success = stripe.succeed(intentId);
    await webhook('payment_intent.succeeded', success).expect(200);
    await webhook('payment_intent.succeeded', success).expect(200);
    assert.equal((await reservation())?.status, 'PENDING');
    assert.equal(stripe.calls.createRefund, 1);
    assert.ok((await payments().findOne({ _id: new Types.ObjectId(paymentId) }))?.autoRefundedAt);
  });
  it('PAY-01 charges the reservation total and confirms the reservation only after a verified success', async () => {
    const { paymentId, intentId } = await startPayment();
    const intent = stripe.intent(intentId);
    assert.equal(intent.amount, TOTAL);
    assert.equal(intent.currency, 'usd');
    assert.equal(intent.metadata.bookingType, 'hotel');
    assert.equal((await reservation())?.status, 'PENDING');

    await webhook('payment_intent.succeeded', stripe.succeed(intentId)).expect(200);
    const stored = await payments().findOne({ _id: new Types.ObjectId(paymentId) });
    assert.equal(stored?.status, 'SUCCEEDED');
    assert.equal(stored?.hotelBookingId.toString(), bookingId);
    assert.ok(stored?.bookingConfirmedAt);
    const confirmed = await reservation();
    assert.equal(confirmed?.status, 'CONFIRMED');
    assert.equal(confirmed?.paymentId.toString(), paymentId);

    // A repeated webhook changes nothing and refunds nothing.
    await webhook('payment_intent.succeeded', stripe.intent(intentId)).expect(200);
    assert.equal(await refunds().countDocuments(), 0);
    await pay().expect(409);
  });

  it('PAY-01 keeps the reservation PENDING after a declined card, so the user can retry', async () => {
    const { paymentId, intentId } = await startPayment();
    await webhook('payment_intent.payment_failed', stripe.decline(intentId)).expect(200);
    assert.equal((await payments().findOne({ _id: new Types.ObjectId(paymentId) }))?.status, 'FAILED');
    assert.equal((await reservation())?.status, 'PENDING');
    assert.deepEqual(failedCalls, [[bookingId, paymentId]]);
    await fixture.http().post(`/api/payments/${paymentId}/retry`).set('Cookie', owner.cookie).expect(200);
  });

  it('PAY-01 refunds in full a payment that succeeds after the hold ended (late payment)', async () => {
    const { paymentId, intentId } = await startPayment();
    await hotelBookings().updateOne({ _id: new Types.ObjectId(bookingId) }, { $set: { status: 'EXPIRED' }, $unset: { holdExpiresAt: 1 } });
    await webhook('payment_intent.succeeded', stripe.succeed(intentId)).expect(200);
    assert.equal((await reservation())?.status, 'EXPIRED');
    const refund = await refunds().findOne({});
    assert.equal(refund?.amount, 450.5);
    assert.equal(refund?.hotelBookingId.toString(), bookingId);
    assert.ok((await payments().findOne({ _id: new Types.ObjectId(paymentId) }))?.autoRefundedAt);
  });

  it('PAY-01 cancels the open PaymentIntent when Person 6 expires the hold (HTL-18)', async () => {
    const { paymentId, intentId } = await startPayment();
    const bookingPayments = fixture.app.get(BookingPaymentsAdapter, { strict: false });
    await bookingPayments.cancelPendingPayment({ bookingType: 'HOTEL', bookingId });
    assert.equal(stripe.intent(intentId).status, 'canceled');
    const stored = await payments().findOne({ _id: new Types.ObjectId(paymentId) });
    assert.equal(stored?.status, 'FAILED');
    assert.equal(stored?.failureReason, HOLD_EXPIRED_REASON);
    // No payment at all is fine too.
    await bookingPayments.cancelPendingPayment({ bookingType: 'HOTEL', bookingId: new Types.ObjectId().toString() });
  });

  it('PAY-03 refunds a cancelled reservation once and shows the authoritative refund status', async () => {
    const { intentId } = await startPayment();
    await webhook('payment_intent.succeeded', stripe.succeed(intentId)).expect(200);
    const bookingPayments = fixture.app.get(BookingPaymentsAdapter, { strict: false });
    assert.equal(await bookingPayments.getRefundStatus({ bookingType: 'HOTEL', bookingId }), null);

    // Person 6 cancels (HTL-21) with a 50% refund in minor units, and retries after a lost answer.
    await hotelBookings().updateOne({ _id: new Types.ObjectId(bookingId) }, { $set: { status: 'CANCELLED' } });
    const request = { bookingType: 'HOTEL' as const, bookingId, amount: 22525, reason: 'Hotel reservation cancelled by the user' };
    const first = await bookingPayments.createRefund(request);
    const again = await bookingPayments.createRefund(request);
    assert.equal(again.refundId, first.refundId);
    assert.equal(stripe.calls.createRefund, 1);

    const pending = await bookingPayments.getRefundStatus({ bookingType: 'HOTEL', bookingId });
    assert.deepEqual(pending, { refundId: first.refundId, status: 'PENDING', amount: 22525, currency: 'USD' });
    // Stripe finishes the refund: the status read checks Stripe and stores the final status.
    const stored = await refunds().findOne({ _id: new Types.ObjectId(first.refundId) });
    stripe.setRefundStatus(stored!.stripeRefundId, 'succeeded');
    const done = await bookingPayments.getRefundStatus({ bookingType: 'HOTEL', bookingId });
    assert.equal(done?.status, 'REFUNDED');
    // Half refunded: the payment stays SUCCEEDED (REFUNDED only when the whole amount came back).
    assert.equal((await payments().findOne({}))?.status, 'SUCCEEDED');
  });
});
