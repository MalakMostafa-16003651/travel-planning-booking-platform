import Stripe from 'stripe';
import { StripeService } from '../src/payments/stripe.service';

export const WEBHOOK_SECRET = 'whsec_test_only_never_a_real_secret';
export const TEST_STRIPE_CONFIG = { STRIPE_SECRET_KEY: 'sk_test_never_used_for_network', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET };

/**
 * Replaces StripeService's network calls with an in-memory Stripe. Webhook
 * signature checks stay real: events are signed like Stripe signs them.
 */
export class FakeStripe {
  intents = new Map<string, Stripe.PaymentIntent>();
  refunds = new Map<string, Stripe.Refund>();
  private refundsByKey = new Map<string, Stripe.Refund>();
  calls = { createIntent: 0, createRefund: 0 };
  failNextCancel = false;
  failNextRefund = false;
  failNextRetrieve = false;
  refundStatus: Stripe.Refund['status'] = 'pending';
  private sequence = 0;

  install(service: StripeService) {
    service.createPaymentIntent = async ({ amount, currency, metadata }) => {
      this.calls.createIntent += 1;
      const id = `pi_test_${++this.sequence}`;
      const intent = { id, object: 'payment_intent', amount, amount_received: 0, currency: currency.toLowerCase(), metadata, status: 'requires_payment_method', client_secret: `${id}_secret`, last_payment_error: null } as unknown as Stripe.PaymentIntent;
      this.intents.set(id, intent);
      return { ...intent };
    };
    service.retrievePaymentIntent = async (id) => ({ ...this.intent(id) });
    service.cancelPaymentIntent = async (id) => {
      if (this.failNextCancel) {
        this.failNextCancel = false;
        throw new Error('Stripe cannot cancel this PaymentIntent');
      }
      const intent = this.intent(id);
      intent.status = 'canceled';
      return { ...intent };
    };
    service.createRefund = async ({ paymentIntentId, amount, metadata }, idempotencyKey) => {
      // Stripe replays the same refund for a repeated idempotency key.
      const replay = this.refundsByKey.get(idempotencyKey);
      if (replay) return { ...replay };
      if (this.failNextRefund) {
        this.failNextRefund = false;
        throw new Error('Stripe is unavailable');
      }
      this.calls.createRefund += 1;
      const refund = { id: `re_test_${++this.sequence}`, object: 'refund', amount, payment_intent: paymentIntentId, metadata, status: this.refundStatus } as unknown as Stripe.Refund;
      this.refunds.set(refund.id, refund);
      this.refundsByKey.set(idempotencyKey, refund);
      return { ...refund };
    };
    service.retrieveRefund = async (id) => {
      if (this.failNextRetrieve) {
        this.failNextRetrieve = false;
        throw new Error('Stripe is unavailable');
      }
      return { ...this.refunds.get(id)! };
    };
    service.listRefunds = async (paymentIntentId) => [...this.refunds.values()].filter((refund) => refund.payment_intent === paymentIntentId);
  }

  intent(id: string): Stripe.PaymentIntent {
    const intent = this.intents.get(id);
    if (!intent) throw new Error(`Unknown PaymentIntent ${id}`);
    return intent;
  }

  /** The customer paid: the intent succeeds with this amount (default: the requested amount). */
  succeed(id: string, amountReceived?: number): Stripe.PaymentIntent {
    const intent = this.intent(id);
    intent.status = 'succeeded';
    intent.amount_received = amountReceived ?? intent.amount;
    return { ...intent };
  }

  /** The card was declined. */
  decline(id: string, message = 'Your card was declined.'): Stripe.PaymentIntent {
    const intent = this.intent(id);
    intent.status = 'requires_payment_method';
    intent.last_payment_error = { message } as Stripe.PaymentIntent.LastPaymentError;
    return { ...intent };
  }

  setRefundStatus(id: string, status: Stripe.Refund['status']): Stripe.Refund {
    const refund = this.refunds.get(id)!;
    refund.status = status;
    return { ...refund };
  }

  /** A webhook body and stripe-signature header, signed with the test secret (optionally at another time or with another secret). */
  static signedEvent(type: string, object: unknown, options: { secret?: string; timestamp?: number } = {}) {
    const payload = JSON.stringify({ id: `evt_test_${Date.now()}`, object: 'event', type, data: { object } });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: options.secret ?? WEBHOOK_SECRET, timestamp: options.timestamp });
    return { payload, signature };
  }
}
