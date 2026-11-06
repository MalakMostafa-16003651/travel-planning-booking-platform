import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { UserRole } from '../src/common/enums/user-role.enum';
import { AMOUNT_MISMATCH_REASON, HOLD_EXPIRED_REASON } from '../src/payments/payments.service';
import { StripeService } from '../src/payments/stripe.service';
import { FakeStripe, TEST_STRIPE_CONFIG } from './fake-stripe';
import { PaymentsFixture } from './payments-fixture';

type Session = { cookie: string; userId: string };

describe('PAY-01 payments and Stripe webhook', { concurrency: false }, () => {
  const fixture = new PaymentsFixture();
  let stripe: FakeStripe;
  let owner: Session;
  let stranger: Session;
  let admin: Session;
  let bookingId: string;

  const payments = () => fixture.connection.collection('payments');
  const refunds = () => fixture.connection.collection('refunds');
  const payment = (paymentId: string) => payments().findOne({ _id: new Types.ObjectId(paymentId) });

  const accept = (id = bookingId, session = owner) =>
    fixture.http().post(`/api/bookings/flight/${id}/accept-policies`).set('Cookie', session.cookie).send({ accepted: true }).expect(200);
  const pay = (id = bookingId, session = owner) =>
    fixture.http().post('/api/payments').set('Cookie', session.cookie).send({ bookingType: 'flight', bookingId: id });
  const webhook = (type: string, object: unknown, options?: { secret?: string; timestamp?: number }) => {
    const { payload, signature } = FakeStripe.signedEvent(type, object, options);
    return fixture.http().post('/api/payments/webhook').set('stripe-signature', signature).set('Content-Type', 'application/json').send(payload);
  };

  /** Accepts the policies and starts paying; returns the payment and its PaymentIntent id. */
  async function startPayment() {
    await accept();
    const response = await pay().expect(201);
    return { paymentId: response.body.payment._id as string, intentId: response.body.payment.stripePaymentIntentId as string };
  }

  before(async () => {
    await fixture.start('payments', undefined, TEST_STRIPE_CONFIG);
  }, { timeout: 30 * 60_000 });

  after(() => fixture.stop());

  beforeEach(async () => {
    await fixture.reset();
    stripe = new FakeStripe();
    stripe.install(fixture.app.get(StripeService));
    owner = await fixture.login('owner@example.com');
    stranger = await fixture.login('stranger@example.com');
    admin = await fixture.login('admin@example.com', UserRole.ADMIN);
    bookingId = await fixture.holdBooking(owner.cookie);
  });

  it('rejects guests, other roles, other users and invalid input', async () => {
    await fixture.http().post('/api/payments').send({ bookingType: 'flight', bookingId }).expect(401);
    await fixture.http().get(`/api/payments/${new Types.ObjectId().toString()}`).expect(401);
    await fixture.http().post(`/api/payments/${new Types.ObjectId().toString()}/retry`).expect(401);
    await pay(bookingId, admin).expect(403);
    await pay(bookingId, stranger).expect(404);
    const badBody = await fixture.http().post('/api/payments').set('Cookie', owner.cookie).send({ bookingType: 'train', bookingId: 'x' }).expect(400);
    assert.deepEqual(Object.keys(badBody.body.errors).sort(), ['bookingId', 'bookingType']);
    // The amount always comes from the booking; a client-sent amount is refused.
    await accept();
    const withAmount = await fixture.http().post('/api/payments').set('Cookie', owner.cookie).send({ bookingType: 'flight', bookingId, amount: 1 }).expect(400);
    assert.ok(withAmount.body.errors.amount);
    await fixture.http().get('/api/payments/not-an-id').set('Cookie', owner.cookie).expect(400);
    assert.equal(stripe.calls.createIntent, 0);
  });

  it('needs the current policies accepted before paying', async () => {
    const response = await pay().expect(409);
    assert.equal(response.body.message, 'Please accept the current booking policies before paying');
    await accept();
    // The airline changes its tiers after acceptance: accept again.
    await fixture.connection.collection('airlines').updateOne({ _id: fixture.airlineId }, { $set: { cancellationTiers: [] } });
    await pay().expect(409);
    await accept();
    await pay().expect(201);
  });

  it('creates the payment with the booking amount and returns the clientSecret once', async () => {
    await accept();
    const response = await pay().expect(201);
    const { payment: created, clientSecret } = response.body;
    assert.equal(created.amount, 150);
    assert.equal(created.currency, 'USD');
    assert.equal(created.status, 'PENDING');
    assert.equal(created.userId, owner.userId);
    assert.equal(created.flightBookingId, bookingId);
    const intent = stripe.intent(created.stripePaymentIntentId);
    assert.equal(intent.amount, 15000);
    assert.equal(intent.currency, 'usd');
    assert.deepEqual(intent.metadata, { paymentId: created._id, bookingType: 'flight', bookingId, userId: owner.userId });
    assert.equal(clientSecret, intent.client_secret);
    const stored = await payment(created._id);
    assert.equal('clientSecret' in stored!, false);

    // Paying again returns the same PENDING payment and intent.
    const again = await pay().expect(201);
    assert.equal(again.body.payment._id, created._id);
    assert.equal(again.body.clientSecret, clientSecret);
    assert.equal(stripe.calls.createIntent, 1);
    assert.equal(await payments().countDocuments(), 1);
  });

  it('refuses a booking that is not in the platform currency (PAY-04)', async () => {
    await accept();
    await fixture.connection.collection('flightbookings').updateOne({ _id: new Types.ObjectId(bookingId) }, { $set: { currency: 'EUR' } });
    assert.equal((await pay().expect(409)).body.message, 'The booking is not in the platform currency');
    assert.equal(stripe.calls.createIntent, 0);
  });

  it('refuses expired holds and bookings that are not PENDING', async () => {
    await accept();
    await fixture.expireHold(bookingId);
    assert.equal((await pay().expect(409)).body.message, 'The booking hold has expired');
    await fixture.connection.collection('flightbookings').updateOne({ _id: new Types.ObjectId(bookingId) }, { $set: { status: 'CANCELLED' } });
    assert.equal((await pay().expect(409)).body.message, 'Only a PENDING booking can be paid');
  });

  it('confirms the booking on a verified success, once, even when Stripe repeats the event', async () => {
    const { paymentId, intentId } = await startPayment();
    const succeeded = stripe.succeed(intentId);
    assert.deepEqual((await webhook('payment_intent.succeeded', succeeded).expect(200)).body, { received: true });
    await webhook('payment_intent.succeeded', succeeded).expect(200);

    const stored = await payment(paymentId);
    assert.equal(stored!.status, 'SUCCEEDED');
    assert.ok(stored!.bookingConfirmedAt);
    const booking = await fixture.connection.collection('flightbookings').findOne({ _id: new Types.ObjectId(bookingId) });
    assert.equal(booking!.status, 'CONFIRMED');
    assert.equal(booking!.paymentId.toString(), paymentId);
    assert.match(booking!.bookingReference, /^[A-Z2-9]{8}$/);
    assert.equal(fixture.notifications.sent.filter((n) => n.type === 'BOOKING_CONFIRMED').length, 1);
    assert.equal(await refunds().countDocuments(), 0);
    await pay().expect(409);
  });

  it('verifies webhook signatures and ignores events it does not use', async () => {
    const { paymentId, intentId } = await startPayment();
    const succeeded = stripe.succeed(intentId);
    const send = (signature?: string, body = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: succeeded } })) => {
      const request = fixture.http().post('/api/payments/webhook').set('Content-Type', 'application/json');
      return (signature ? request.set('stripe-signature', signature) : request).send(body);
    };
    assert.equal((await send().expect(400)).body.message, 'Missing Stripe signature');
    assert.equal((await send('t=1,v1=bad').expect(400)).body.message, 'Invalid Stripe signature');
    // Signed with another secret.
    await webhook('payment_intent.succeeded', succeeded, { secret: 'whsec_someone_else' }).expect(400);
    // An old captured event, outside Stripe's 5-minute tolerance.
    await webhook('payment_intent.succeeded', succeeded, { timestamp: Math.floor(Date.now() / 1000) - 3600 }).expect(400);
    // A tampered body with the signature of the original body.
    const { payload, signature } = FakeStripe.signedEvent('payment_intent.succeeded', succeeded);
    await send(signature, payload.replace('"amount_received":15000', '"amount_received":1')).expect(400);
    assert.equal((await payment(paymentId))!.status, 'PENDING');

    // Unknown event types and unknown PaymentIntents are acknowledged and change nothing.
    await webhook('customer.created', { id: 'cus_1' }).expect(200);
    await webhook('payment_intent.succeeded', { ...succeeded, id: 'pi_unknown', metadata: {} }).expect(200);
    assert.equal((await payment(paymentId))!.status, 'PENDING');
  });

  it('records a failure, never undoes a success, and lets the user retry', async () => {
    const { paymentId, intentId } = await startPayment();
    await webhook('payment_intent.payment_failed', stripe.decline(intentId)).expect(200);
    let stored = await payment(paymentId);
    assert.equal(stored!.status, 'FAILED');
    assert.equal(stored!.failureReason, 'Your card was declined.');
    assert.equal(await fixture.bookingStatus(bookingId), 'PENDING');
    assert.match((await pay().expect(409)).body.message, new RegExp(`/api/payments/${paymentId}/retry`));

    await fixture.http().post(`/api/payments/${paymentId}/retry`).set('Cookie', stranger.cookie).expect(404);
    const retried = await fixture.http().post(`/api/payments/${paymentId}/retry`).set('Cookie', owner.cookie).expect(200);
    assert.equal(retried.body.payment._id, paymentId);
    assert.equal(retried.body.payment.status, 'PENDING');
    const newIntentId = retried.body.payment.stripePaymentIntentId as string;
    assert.notEqual(newIntentId, intentId);
    assert.equal(stripe.intent(intentId).status, 'canceled');
    await fixture.http().post(`/api/payments/${paymentId}/retry`).set('Cookie', owner.cookie).expect(409);

    // A late failure for the old intent does not touch the retried payment.
    await webhook('payment_intent.payment_failed', stripe.decline(intentId)).expect(200);
    assert.equal((await payment(paymentId))!.status, 'PENDING');

    await webhook('payment_intent.succeeded', stripe.succeed(newIntentId)).expect(200);
    // A failure arriving after the success is ignored.
    await webhook('payment_intent.payment_failed', stripe.decline(newIntentId)).expect(200);
    stored = await payment(paymentId);
    assert.equal(stored!.status, 'SUCCEEDED');
    assert.equal(await fixture.bookingStatus(bookingId), 'CONFIRMED');
  });

  it('lets only one of two concurrent retries win', async () => {
    const { paymentId, intentId } = await startPayment();
    await webhook('payment_intent.payment_failed', stripe.decline(intentId)).expect(200);
    const results = await Promise.all([1, 2].map(() => fixture.http().post(`/api/payments/${paymentId}/retry`).set('Cookie', owner.cookie)));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  });

  it('never confirms a wrong amount and never retries it', async () => {
    const { paymentId, intentId } = await startPayment();
    await webhook('payment_intent.succeeded', stripe.succeed(intentId, 100)).expect(200);
    const stored = await payment(paymentId);
    assert.equal(stored!.status, 'FAILED');
    assert.equal(stored!.failureReason, AMOUNT_MISMATCH_REASON);
    assert.equal(await fixture.bookingStatus(bookingId), 'PENDING');
    const retry = await fixture.http().post(`/api/payments/${paymentId}/retry`).set('Cookie', owner.cookie).expect(409);
    assert.equal(retry.body.message, 'This payment needs a manual check by an admin and cannot be retried');
  });

  it('refunds in full, once, when the money arrives after the hold ended', async () => {
    const { paymentId, intentId } = await startPayment();
    await fixture.expireHold(bookingId);
    const succeeded = stripe.succeed(intentId);
    await webhook('payment_intent.succeeded', succeeded).expect(200);
    await webhook('payment_intent.succeeded', succeeded).expect(200);
    const stored = await payment(paymentId);
    assert.equal(stored!.status, 'SUCCEEDED');
    assert.ok(stored!.autoRefundedAt);
    assert.equal(stored!.bookingConfirmedAt, undefined);
    assert.equal(await fixture.bookingStatus(bookingId), 'PENDING');
    const stored_refunds = await refunds().find().toArray();
    assert.equal(stored_refunds.length, 1);
    assert.equal(stored_refunds[0].amount, 150);
    assert.equal(stored_refunds[0].stripePaymentIntentId, intentId);
    assert.equal(stripe.calls.createRefund, 1);
  });

  it('finishes a success that crashed half way when Stripe redelivers it', async () => {
    const { paymentId, intentId } = await startPayment();
    // As if the first delivery stored SUCCEEDED and then crashed before confirming.
    await payments().updateOne({ _id: new Types.ObjectId(paymentId) }, { $set: { status: 'SUCCEEDED' } });
    await webhook('payment_intent.succeeded', stripe.succeed(intentId)).expect(200);
    assert.equal(await fixture.bookingStatus(bookingId), 'CONFIRMED');
    assert.ok((await payment(paymentId))!.bookingConfirmedAt);
    assert.equal(await refunds().countDocuments(), 0);
  });

  it('does nothing on a redelivery after the user cancelled the confirmed booking', async () => {
    const { paymentId, intentId } = await startPayment();
    const succeeded = stripe.succeed(intentId);
    await webhook('payment_intent.succeeded', succeeded).expect(200);
    await fixture.connection.collection('flightbookings').updateOne({ _id: new Types.ObjectId(bookingId) }, { $set: { status: 'CANCELLED' } });
    await webhook('payment_intent.succeeded', succeeded).expect(200);
    assert.equal(await refunds().countDocuments(), 0);
    assert.equal((await payment(paymentId))!.status, 'SUCCEEDED');
  });

  it('handles a success for an older intent after a retry', async () => {
    const { paymentId, intentId } = await startPayment();
    await webhook('payment_intent.payment_failed', stripe.decline(intentId)).expect(200);
    const retried = await fixture.http().post(`/api/payments/${paymentId}/retry`).set('Cookie', owner.cookie).expect(200);
    const newIntentId = retried.body.payment.stripePaymentIntentId as string;

    // The old intent was paid after all: found through metadata.paymentId, the newer intent is cancelled.
    await webhook('payment_intent.succeeded', stripe.succeed(intentId)).expect(200);
    let stored = await payment(paymentId);
    assert.equal(stored!.status, 'SUCCEEDED');
    assert.equal(stored!.stripePaymentIntentId, intentId);
    assert.equal(stripe.intent(newIntentId).status, 'canceled');
    assert.equal(await fixture.bookingStatus(bookingId), 'CONFIRMED');

    // If the newer one was paid too, that extra money goes back in full, once.
    stripe.intent(newIntentId).status = 'requires_payment_method';
    const extra = stripe.succeed(newIntentId);
    await webhook('payment_intent.succeeded', { ...extra, metadata: { paymentId } }).expect(200);
    await webhook('payment_intent.succeeded', { ...extra, metadata: { paymentId } }).expect(200);
    const extraRefunds = await refunds().find({ stripePaymentIntentId: newIntentId }).toArray();
    assert.equal(extraRefunds.length, 1);
    assert.equal(extraRefunds[0].amount, 150);
    stored = await payment(paymentId);
    assert.equal(stored!.status, 'SUCCEEDED');
  });

  it('applies an old intent that succeeded when the retry could not cancel it', async () => {
    const { paymentId, intentId } = await startPayment();
    await webhook('payment_intent.payment_failed', stripe.decline(intentId)).expect(200);
    stripe.succeed(intentId);
    stripe.failNextCancel = true;
    const retry = await fixture.http().post(`/api/payments/${paymentId}/retry`).set('Cookie', owner.cookie).expect(409);
    assert.equal(retry.body.message, 'The previous payment attempt succeeded, no retry is needed');
    assert.equal((await payment(paymentId))!.status, 'SUCCEEDED');
    assert.equal(await fixture.bookingStatus(bookingId), 'CONFIRMED');
    assert.equal(stripe.calls.createIntent, 1);
  });

  it('shows a payment to its owner and to admins, checking a PENDING one with Stripe', async () => {
    const { paymentId, intentId } = await startPayment();
    let read = await fixture.http().get(`/api/payments/${paymentId}`).set('Cookie', owner.cookie).expect(200);
    assert.equal(read.body.status, 'PENDING');
    await fixture.http().get(`/api/payments/${paymentId}`).set('Cookie', stranger.cookie).expect(404);
    await fixture.http().get(`/api/payments/${new Types.ObjectId().toString()}`).set('Cookie', owner.cookie).expect(404);

    // The webhook has not arrived yet, but Stripe already says succeeded.
    stripe.succeed(intentId);
    read = await fixture.http().get(`/api/payments/${paymentId}`).set('Cookie', admin.cookie).expect(200);
    assert.equal(read.body.status, 'SUCCEEDED');
    assert.equal(await fixture.bookingStatus(bookingId), 'CONFIRMED');
  });

  it('does not refund when the webhook and a status check handle the same success at once', async () => {
    const { paymentId, intentId } = await startPayment();
    const succeeded = stripe.succeed(intentId);
    await Promise.all([
      webhook('payment_intent.succeeded', succeeded).expect(200),
      fixture.http().get(`/api/payments/${paymentId}`).set('Cookie', owner.cookie).expect(200),
      webhook('payment_intent.succeeded', succeeded).expect(200),
    ]);
    assert.equal(await fixture.bookingStatus(bookingId), 'CONFIRMED');
    assert.equal(await refunds().countDocuments(), 0);
    assert.ok((await payment(paymentId))!.bookingConfirmedAt);
  });

  it('syncs refund status from refund.updated and charge.refunded, and never moves a final status back', async () => {
    const { paymentId, intentId } = await startPayment();
    await fixture.expireHold(bookingId);
    await webhook('payment_intent.succeeded', stripe.succeed(intentId)).expect(200);
    const refund = await refunds().findOne();
    assert.equal(refund!.status, 'PENDING');

    await webhook('charge.refunded', { id: 'ch_1', object: 'charge', payment_intent: intentId }).expect(200);
    assert.equal((await refunds().findOne())!.status, 'PENDING');
    await webhook('refund.updated', stripe.setRefundStatus(refund!.stripeRefundId, 'succeeded')).expect(200);
    assert.equal((await refunds().findOne())!.status, 'REFUNDED');
    assert.equal((await payment(paymentId))!.status, 'REFUNDED');
    await webhook('refund.updated', { ...stripe.refunds.get(refund!.stripeRefundId), status: 'failed' }).expect(200);
    assert.equal((await refunds().findOne())!.status, 'REFUNDED');
  });

  it('cancels the PaymentIntent when Person 4 expires the hold', async () => {
    const { paymentId, intentId } = await startPayment();
    await fixture.expireHold(bookingId);
    assert.equal(await fixture.flightBookings.expireOverdueHolds(), 1);
    assert.equal(await fixture.bookingStatus(bookingId), 'EXPIRED');
    assert.equal(stripe.intent(intentId).status, 'canceled');
    const stored = await payment(paymentId);
    assert.equal(stored!.status, 'FAILED');
    assert.equal(stored!.failureReason, HOLD_EXPIRED_REASON);
    await fixture.http().post(`/api/payments/${paymentId}/retry`).set('Cookie', owner.cookie).expect(409);
  });

  it('refunds when the money arrived just before the hold expired and the intent could not be cancelled', async () => {
    const { paymentId, intentId } = await startPayment();
    stripe.succeed(intentId);
    stripe.failNextCancel = true;
    await fixture.expireHold(bookingId);
    await fixture.flightBookings.expireOverdueHolds();
    const stored = await payment(paymentId);
    assert.equal(stored!.status, 'SUCCEEDED');
    assert.ok(stored!.autoRefundedAt);
    assert.equal(await refunds().countDocuments({ stripePaymentIntentId: intentId }), 1);
    assert.equal(await fixture.bookingStatus(bookingId), 'EXPIRED');
  });

  it('expires a hold without a payment', async () => {
    await fixture.expireHold(bookingId);
    assert.equal(await fixture.flightBookings.expireOverdueHolds(), 1);
    assert.equal(await fixture.bookingStatus(bookingId), 'EXPIRED');
  });

  it('lists every endpoint in Swagger with its requirement ID and the webhook without a cookie', async () => {
    const document = (await fixture.http().get('/api/docs-json').expect(200)).body;
    const operations = [
      document.paths['/api/payments'].post,
      document.paths['/api/payments/{id}'].get,
      document.paths['/api/payments/{id}/retry'].post,
      document.paths['/api/payments/webhook'].post,
    ];
    for (const operation of operations) assert.match(operation.summary, /^PAY-01/);
    assert.equal(document.paths['/api/payments/webhook'].post.security, undefined);
    assert.deepEqual(document.paths['/api/payments'].post.security, [{ accessToken: [] }]);
  });
});
