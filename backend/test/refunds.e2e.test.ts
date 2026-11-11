import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import { Types } from 'mongoose';
import { UserRole } from '../src/common/enums/user-role.enum';
import { BookingPaymentsAdapter } from '../src/payments/adapters/booking-payments.adapter';
import { RefundsService } from '../src/payments/refunds.service';
import { StripeService } from '../src/payments/stripe.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { FakeStripe, TEST_STRIPE_CONFIG } from './fake-stripe';
import { PaymentsFixture } from './payments-fixture';

type Session = { cookie: string; userId: string };

describe('PAY-03 refunds', { concurrency: false }, () => {
  const fixture = new PaymentsFixture();
  let stripe: FakeStripe;
  let refundsService: RefundsService;
  let adapter: BookingPaymentsAdapter;
  let owner: Session;
  let stranger: Session;
  let admin: Session;
  let bookingId: string;
  let paymentId: string;
  let intentId: string;

  const refunds = () => fixture.connection.collection('refunds');
  const booking = () => fixture.connection.collection('flightbookings').findOne({ _id: new Types.ObjectId(bookingId) });
  const payment = () => fixture.connection.collection('payments').findOne({ _id: new Types.ObjectId(paymentId) });
  const webhook = (type: string, object: unknown) => {
    const { payload, signature } = FakeStripe.signedEvent(type, object);
    return fixture.http().post('/api/payments/webhook').set('stripe-signature', signature).set('Content-Type', 'application/json').send(payload);
  };
  const readRefund = (refundId: string, session?: Session) => {
    const request = fixture.http().get(`/api/refunds/${refundId}`);
    return session ? request.set('Cookie', session.cookie) : request;
  };

  before(async () => {
    await fixture.start('refunds', undefined, TEST_STRIPE_CONFIG);
    refundsService = fixture.app.get(RefundsService);
    adapter = fixture.app.get(BookingPaymentsAdapter);
  }, { timeout: 30 * 60_000 });

  after(() => fixture.stop());

  /** Each test starts with a CONFIRMED, paid booking of 150.00 USD departing in 30 days. */
  beforeEach(async () => {
    await fixture.reset();
    stripe = new FakeStripe();
    stripe.install(fixture.app.get(StripeService));
    owner = await fixture.login('owner@example.com');
    stranger = await fixture.login('stranger@example.com');
    admin = await fixture.login('admin@example.com', UserRole.ADMIN);
    bookingId = await fixture.holdBooking(owner.cookie);
    await fixture.http().post(`/api/bookings/flight/${bookingId}/accept-policies`).set('Cookie', owner.cookie).send({ accepted: true }).expect(200);
    const paid = await fixture.http().post('/api/payments').set('Cookie', owner.cookie).send({ bookingType: 'flight', bookingId }).expect(201);
    paymentId = paid.body.payment._id;
    intentId = paid.body.payment.stripePaymentIntentId;
    await webhook('payment_intent.succeeded', stripe.succeed(intentId)).expect(200);
    assert.equal((await booking())!.status, 'CONFIRMED');
  });

  it("refunds a user's cancellation by the airline tier and shows its status", async () => {
    // 30 days before departure: the 7-day tier gives 50%.
    const cancelled = await fixture.http().post(`/api/flight-bookings/${bookingId}/cancel`).set('Cookie', owner.cookie).expect(200);
    const refundId = cancelled.body.refundId as string;
    assert.ok(refundId);
    assert.equal(cancelled.body.refundAmount, 7500);
    assert.equal((await booking())!.refundDue, false);

    const stored = await refunds().findOne({ _id: new Types.ObjectId(refundId) });
    assert.equal(stored!.amount, 75);
    assert.equal(stored!.currency, 'USD');
    assert.equal(stored!.status, 'PENDING');
    assert.equal(stored!.userId.toString(), owner.userId);
    assert.equal(stored!.paymentId.toString(), paymentId);
    assert.equal(stored!.flightBookingId.toString(), bookingId);
    assert.equal(stored!.reason, 'Booking cancelled by the user');
    assert.equal(stripe.refunds.get(stored!.stripeRefundId)!.amount, 7500);
    assert.equal(stripe.refunds.get(stored!.stripeRefundId)!.payment_intent, intentId);

    assert.equal((await readRefund(refundId, owner).expect(200)).body.status, 'PENDING');
    await webhook('refund.updated', stripe.setRefundStatus(stored!.stripeRefundId, 'succeeded')).expect(200);
    assert.equal((await readRefund(refundId, owner).expect(200)).body.status, 'REFUNDED');
    // A partial refund leaves the payment SUCCEEDED.
    assert.equal((await payment())!.status, 'SUCCEEDED');
  });

  it('refunds 100% when the airline cancels the flight, and marks the payment REFUNDED', async () => {
    const flightId = (await booking())!.segments[0].flightId.toString();
    await fixture.flightBookings.cancelBookingsForFlight(flightId);
    const current = await booking();
    assert.equal(current!.status, 'CANCELLED');
    assert.equal(current!.refundAmount, 15000);
    const stored = await refunds().findOne({ _id: current!.refundId });
    assert.equal(stored!.amount, 150);
    assert.equal(stored!.reason, 'Flight cancelled by the airline');
    await webhook('charge.refunded', { id: 'ch_1', object: 'charge', payment_intent: intentId }).expect(200);
    await webhook('refund.updated', stripe.setRefundStatus(stored!.stripeRefundId, 'succeeded')).expect(200);
    assert.equal((await payment())!.status, 'REFUNDED');
  });

  it('shows FAILED when Stripe reports the refund failed', async () => {
    const cancelled = await fixture.http().post(`/api/flight-bookings/${bookingId}/cancel`).set('Cookie', owner.cookie).expect(200);
    const stored = await refunds().findOne({ _id: new Types.ObjectId(cancelled.body.refundId) });
    stripe.setRefundStatus(stored!.stripeRefundId, 'failed');
    // No webhook yet: reading the PENDING refund asks Stripe.
    assert.equal((await readRefund(cancelled.body.refundId, owner).expect(200)).body.status, 'FAILED');
  });

  it('is idempotent per booking, because the booking module retries', async () => {
    const request = { bookingType: 'FLIGHT' as const, bookingId, amount: 7500, reason: 'Booking cancelled by the user' };
    const first = await adapter.createRefund(request);
    const second = await adapter.createRefund(request);
    assert.equal(second.refundId, first.refundId);
    assert.equal(stripe.calls.createRefund, 1);
    assert.equal(await refunds().countDocuments(), 1);
  });

  it('retries a refund that failed to reach Stripe through the booking module', async () => {
    stripe.failNextRefund = true;
    await fixture.http().post(`/api/flight-bookings/${bookingId}/cancel`).set('Cookie', owner.cookie).expect(200);
    assert.equal((await booking())!.refundDue, true);
    assert.equal(await refunds().countDocuments(), 0);
    await fixture.flightBookings.retryDueRefunds();
    const current = await booking();
    assert.equal(current!.refundDue, false);
    assert.equal(await refunds().countDocuments({ _id: current!.refundId }), 1);
  });

  it('shows a refund only to its owner and admins', async () => {
    const cancelled = await fixture.http().post(`/api/flight-bookings/${bookingId}/cancel`).set('Cookie', owner.cookie).expect(200);
    const refundId = cancelled.body.refundId as string;
    await readRefund(refundId).expect(401);
    await readRefund(refundId, stranger).expect(404);
    await readRefund(refundId, admin).expect(200);
    await readRefund(new Types.ObjectId().toString(), owner).expect(404);
    await readRefund('not-an-id', owner).expect(400);
  });

  it('returns the stored refund when Stripe cannot be reached', async () => {
    const cancelled = await fixture.http().post(`/api/flight-bookings/${bookingId}/cancel`).set('Cookie', owner.cookie).expect(200);
    stripe.failNextRetrieve = true;
    assert.equal((await readRefund(cancelled.body.refundId, owner).expect(200)).body.status, 'PENDING');
  });

  it('checks refund amounts in minor units and never refunds more than was paid', async () => {
    const refund = (amount: number) => refundsService.createRefund({ bookingType: 'flight', bookingId, amount, reason: 'test' });
    await assert.rejects(refund(Number.NaN), { status: 400, message: 'Refund amount must be a number' });
    await assert.rejects(refund(0), { status: 400 });
    await assert.rejects(refund(-1), { status: 400 });
    await assert.rejects(refund(150.01), { status: 400, message: 'Refund amount is more than the refundable 150 USD' });
    // 0.1 + 0.2 style amounts add up exactly.
    await refund(0.1);
    await refund(0.2);
    await refund(149.7);
    await assert.rejects(refund(0.01), { status: 400 });
    const minor = stripe.calls.createRefund;
    assert.equal(minor, 3);
    await assert.rejects(
      refundsService.createRefund({ bookingType: 'flight', bookingId: new Types.ObjectId().toString(), amount: 1, reason: 'test' }),
      { status: 404, message: 'No successful payment for this booking' },
    );
  });

  it('does not count FAILED refunds and uses a new idempotency key after one', async () => {
    const first = await refundsService.createRefund({ bookingType: 'flight', bookingId, amount: 150, reason: 'test' });
    await webhook('refund.updated', stripe.setRefundStatus(first.stripeRefundId, 'failed')).expect(200);
    // The same amount again is a new Stripe refund, not a replay of the failed one.
    const second = await refundsService.createRefund({ bookingType: 'flight', bookingId, amount: 150, reason: 'test' });
    assert.notEqual(second.stripeRefundId, first.stripeRefundId);
    assert.notEqual(second._id.toString(), first._id.toString());
    assert.equal(stripe.calls.createRefund, 2);
  });

  it('models Stripe rejecting changed parameters on an existing idempotency key', async () => {
    const service = fixture.app.get(StripeService);
    const params = { paymentIntentId: intentId, amount: 7500, metadata: { refundId: 'first' } };
    const first = await service.createRefund(params, 'strict-refund-key');
    assert.equal((await service.createRefund(params, 'strict-refund-key')).id, first.id);
    await assert.rejects(service.createRefund({ ...params, metadata: { refundId: 'different' } }, 'strict-refund-key'), /same parameters/);
    assert.equal(stripe.calls.createRefund, 1);
  });

  it('recovers a cancellation refund after Stripe accepts it but its response is lost', async () => {
    stripe.loseNextRefundResponse = true;
    await fixture.http().post(`/api/flight-bookings/${bookingId}/cancel`).set('Cookie', owner.cookie).expect(200);
    assert.equal((await booking())!.refundDue, true);
    assert.equal(stripe.refunds.size, 1);
    assert.equal(await refunds().countDocuments(), 0);
    await fixture.flightBookings.retryDueRefunds();
    const current = await booking();
    assert.equal(current!.refundDue, false);
    const stored = await refunds().findOne({ _id: current!.refundId });
    assert.ok(stored);
    assert.equal(stripe.calls.createRefund, 1);
    assert.equal(stripe.refunds.get(stored.stripeRefundId)?.metadata?.refundId, stored._id.toString());
  });

  it('recovers a refund when its local insert failed after Stripe accepted it', async () => {
    const model = fixture.connection.models.Refund;
    const insert = mock.method(model, 'create', async () => { throw new Error('Temporary database insert failure'); });
    const input = { bookingType: 'flight' as const, bookingId, amount: 75, reason: 'Booking cancelled by the user' };
    try {
      await assert.rejects(refundsService.refundCancelledBooking(input), /Temporary database/);
    } finally {
      insert.mock.restore();
    }
    assert.equal(await refunds().countDocuments(), 0);
    const stored = await refundsService.refundCancelledBooking(input);
    assert.equal(stripe.calls.createRefund, 1);
    assert.equal(await refunds().countDocuments(), 1);
    assert.equal(stripe.refunds.get(stored.stripeRefundId)?.metadata?.refundId, stored._id.toString());
  });

  for (const failure of ['lost response', 'local insert'] as const) {
    it(`recovers a double-payment refund after a ${failure} failure`, async () => {
      const service = fixture.app.get(StripeService);
      const extra = await service.createPaymentIntent({ amount: 15000, currency: 'USD', metadata: { paymentId } });
      const intent = stripe.succeed(extra.id);
      const paid = await fixture.connection.models.Payment.findById(paymentId).orFail().exec();
      const insert = failure === 'local insert'
        ? mock.method(fixture.connection.models.Refund, 'create', async () => { throw new Error('Temporary database insert failure'); })
        : undefined;
      stripe.loseNextRefundResponse = failure === 'lost response';
      try {
        await assert.rejects(refundsService.refundExtraIntent(paid, intent));
      } finally {
        insert?.mock.restore();
      }
      const stored = await refundsService.refundExtraIntent(paid, intent);
      assert.equal(stripe.calls.createRefund, 1);
      assert.equal(await refunds().countDocuments(), 1);
      assert.equal(stripe.refunds.get(stored.stripeRefundId)?.metadata?.refundId, stored._id.toString());
      assert.equal((await payment())!.status, 'SUCCEEDED');
    });
  }

  for (const kind of ['cancellation', 'double-payment'] as const) {
    it(`persists one refund for parallel ${kind} deliveries`, { timeout: 15_000 }, async () => {
      const model = fixture.connection.models.Refund;
      let arrived = 0;
      let release!: () => void;
      const allArrived = new Promise<void>((resolve) => { release = resolve; });
      // Both services must reach insertion, forcing the unique-index race deterministically.
      const originalCreate = model.create.bind(model) as (...args: unknown[]) => Promise<unknown>;
      const insert = mock.method(model, 'create', async (...args: unknown[]) => {
        if (++arrived === 2) release();
        await allArrived;
        return originalCreate(...args);
      });
      try {
        let run: () => ReturnType<RefundsService['createRefund']>;
        if (kind === 'cancellation') {
          run = () => refundsService.refundCancelledBooking({ bookingType: 'flight', bookingId, amount: 75, reason: 'Booking cancelled by the user' });
        } else {
          const extra = await fixture.app.get(StripeService).createPaymentIntent({ amount: 15000, currency: 'USD', metadata: { paymentId } });
          const intent = stripe.succeed(extra.id);
          const paid = await fixture.connection.models.Payment.findById(paymentId).orFail().exec();
          run = () => refundsService.refundExtraIntent(paid, intent);
        }
        const [first, second] = await Promise.all([run(), run()]);
        assert.equal(first._id.toString(), second._id.toString());
        assert.equal(await refunds().countDocuments(), 1);
        assert.equal(stripe.calls.createRefund, 1);
      } finally {
        insert.mock.restore();
      }
    });
  }

  describe('PAY-03/GEN-01 refund notifications', () => {
    const refundNotices = () => fixture.connection.collection('notifications').find({ type: 'REFUND_ISSUED' }).toArray();

    it('notifies the owner once, when Stripe completes the refund', async () => {
      const cancelled = await fixture.http().post(`/api/flight-bookings/${bookingId}/cancel`).set('Cookie', owner.cookie).expect(200);
      const stored = await refunds().findOne({ _id: new Types.ObjectId(cancelled.body.refundId) });
      // Still PENDING at Stripe: nothing to tell yet.
      assert.equal((await refundNotices()).length, 0);
      const completed = stripe.setRefundStatus(stored!.stripeRefundId, 'succeeded');
      await webhook('refund.updated', completed).expect(200);
      await webhook('refund.updated', completed).expect(200);
      await webhook('charge.refunded', { id: 'ch_1', object: 'charge', payment_intent: intentId }).expect(200);
      const notices = await refundNotices();
      assert.equal(notices.length, 1);
      assert.equal(notices[0].userId.toString(), owner.userId);
      assert.equal(notices[0].message, 'Your refund of 75.00 USD has been completed.');
      // The owner sees it through Person 2's notifications API.
      const listed = await fixture.http().get('/api/notifications').set('Cookie', owner.cookie).expect(200);
      assert.ok(JSON.stringify(listed.body).includes('Your refund of 75.00 USD has been completed.'));
    });

    it('notifies at once when Stripe completes the refund immediately, and tells the user about a failed refund', async () => {
      stripe.refundStatus = 'succeeded';
      await fixture.http().post(`/api/flight-bookings/${bookingId}/cancel`).set('Cookie', owner.cookie).expect(200);
      assert.deepEqual((await refundNotices()).map((notice) => notice.message), ['Your refund of 75.00 USD has been completed.']);

      stripe.refundStatus = 'pending';
      const failed = await refundsService.createRefund({ bookingType: 'flight', bookingId, amount: 10, reason: 'test' });
      await webhook('refund.updated', stripe.setRefundStatus(failed.stripeRefundId, 'failed')).expect(200);
      const messages = (await refundNotices()).map((notice) => notice.message);
      assert.deepEqual(messages, ['Your refund of 75.00 USD has been completed.', 'Your refund of 10.00 USD could not be completed. Our team will follow up.']);
    });

    it('keeps the refund when the notification cannot be created', async () => {
      const notifications = fixture.app.get(NotificationsService);
      const failing = mock.method(notifications, 'notify', async () => { throw new Error('notifications down'); });
      try {
        stripe.refundStatus = 'succeeded';
        await fixture.http().post(`/api/flight-bookings/${bookingId}/cancel`).set('Cookie', owner.cookie).expect(200);
      } finally {
        failing.mock.restore();
      }
      assert.equal(failing.mock.callCount(), 1);
      const stored = await refunds().findOne({ _id: (await booking())!.refundId });
      assert.equal(stored!.status, 'REFUNDED');
      assert.equal((await booking())!.refundDue, false);
      assert.equal(await fixture.connection.collection('notificationevents').countDocuments(), 1);
      await notifications.processEvents();
      await notifications.processEvents();
      assert.equal((await refundNotices()).length, 1);
      assert.equal(await fixture.connection.collection('notificationevents').countDocuments(), 0);
    });
  });

  it('lists the refund endpoint in Swagger with PAY-03', async () => {
    const document = (await fixture.http().get('/api/docs-json').expect(200)).body;
    assert.match(document.paths['/api/refunds/{id}'].get.summary, /^PAY-03/);
  });
});
