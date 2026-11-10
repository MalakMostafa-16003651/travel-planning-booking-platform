import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Types } from 'mongoose';
import { FlightBookingsMaintenanceService } from '../src/flight-bookings/flight-bookings-maintenance.service';
import { BOOKING_NOTIFICATIONS } from '../src/flight-bookings/ports/booking-notifications.port';
import { BOOKING_PAYMENTS } from '../src/flight-bookings/ports/booking-payments.port';
import { NotificationsService } from '../src/notifications/notifications.service';
import { BookingPaymentsAdapter } from '../src/payments/adapters/booking-payments.adapter';
import { StripeService } from '../src/payments/stripe.service';
import { FakeStripe, TEST_STRIPE_CONFIG } from './fake-stripe';
import { PaymentsFixture } from './payments-fixture';

type Session = { cookie: string; userId: string };

/**
 * FLT-22/23/26 with the production bindings: Person 8's Payments and Person 2's Notifications.
 * Only Stripe's network calls are replaced (FakeStripe); webhook signatures stay real.
 */
describe('Flight bookings with real Payments and Notifications', { concurrency: false }, () => {
  const fixture = new PaymentsFixture();
  let stripe: FakeStripe;
  let owner: Session;
  let bookingId: string;

  const booking = () => fixture.connection.collection('flightbookings').findOne({ _id: new Types.ObjectId(bookingId) });
  const notificationTypes = async (userId: string) => (await fixture.connection.collection('notifications')
    .find({ userId: new Types.ObjectId(userId) }).toArray()).map(({ type }) => type as string);
  const webhook = (type: string, object: unknown) => {
    const { payload, signature } = FakeStripe.signedEvent(type, object);
    return fixture.http().post('/api/payments/webhook').set('stripe-signature', signature).set('Content-Type', 'application/json').send(payload);
  };
  const details = () => fixture.http().get(`/api/flight-bookings/${bookingId}`).set('Cookie', owner.cookie).expect(200);

  async function startPayment(): Promise<string> {
    await fixture.http().post(`/api/bookings/flight/${bookingId}/accept-policies`).set('Cookie', owner.cookie).send({ accepted: true }).expect(200);
    const paid = await fixture.http().post('/api/payments').set('Cookie', owner.cookie).send({ bookingType: 'flight', bookingId }).expect(201);
    return paid.body.payment.stripePaymentIntentId as string;
  }

  before(async () => {
    // Undo the fixture's fake notifications so Person 2's real service receives them.
    await fixture.start('flight-bookings-integration', (builder) => builder
      .overrideProvider(BOOKING_NOTIFICATIONS).useFactory({ factory: (service: NotificationsService) => service, inject: [NotificationsService] }),
    TEST_STRIPE_CONFIG);
  }, { timeout: 30 * 60_000 });

  after(() => fixture.stop());

  beforeEach(async () => {
    await fixture.reset();
    stripe = new FakeStripe();
    stripe.install(fixture.app.get(StripeService));
    owner = await fixture.login('owner@example.com');
    bookingId = await fixture.holdBooking(owner.cookie);
  });

  it('binds the production ports to Payments and Notifications', () => {
    assert.ok(fixture.app.get(BOOKING_PAYMENTS, { strict: false }) instanceof BookingPaymentsAdapter);
  });

  it('FLT-23: confirms after a verified payment and stores the confirmation notification', async () => {
    const intentId = await startPayment();
    await webhook('payment_intent.succeeded', stripe.succeed(intentId)).expect(200);

    const confirmed = await booking();
    assert.equal(confirmed!.status, 'CONFIRMED');
    assert.match(confirmed!.bookingReference, /^[A-Z2-9]{8}$/);
    assert.deepEqual(await notificationTypes(owner.userId), ['BOOKING_CONFIRMED']);
  });

  it('FLT-26/PAY-03: cancels, refunds through Payments and shows the refund status on the details', async () => {
    const intentId = await startPayment();
    await webhook('payment_intent.succeeded', stripe.succeed(intentId)).expect(200);

    const cancelled = await fixture.http().post(`/api/flight-bookings/${bookingId}/cancel`).set('Cookie', owner.cookie).expect(200);
    // 30 days before departure: the fixture airline's 7-day tier refunds 50% of 150.00.
    assert.equal(cancelled.body.refundAmount, 7500);
    assert.deepEqual({ ...cancelled.body.refund, refundId: undefined }, { refundId: undefined, status: 'PENDING', amount: 7500, currency: 'USD' });
    assert.ok((await notificationTypes(owner.userId)).includes('BOOKING_CANCELLED'));

    const stored = await fixture.connection.collection('refunds').findOne({ _id: new Types.ObjectId(cancelled.body.refund.refundId) });
    await webhook('refund.updated', stripe.setRefundStatus(stored!.stripeRefundId, 'succeeded')).expect(200);
    assert.equal((await details()).body.refund.status, 'REFUNDED');
  });

  it('FLT-22/PAY-01: hold expiry releases the seats and cancels the open PaymentIntent', async () => {
    const intentId = await startPayment();
    await fixture.expireHold(bookingId);

    await fixture.app.get(FlightBookingsMaintenanceService, { strict: false }).sweep();

    assert.equal((await booking())!.status, 'EXPIRED');
    assert.equal(stripe.intent(intentId).status, 'canceled');
    const cabin = await fixture.connection.collection('cabininventories').findOne({});
    assert.equal(cabin!.heldSeats, 0);
  });

  it('shows no refund block on bookings that have no refund', async () => {
    assert.equal((await details()).body.refund, undefined);
  });
});
