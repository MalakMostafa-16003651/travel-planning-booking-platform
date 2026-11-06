import { BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/** Thin wrapper around the Stripe SDK, so tests can replace the network calls. */
@Injectable()
export class StripeService {
  private client?: Stripe;

  constructor(private readonly config: ConfigService) {}

  createPaymentIntent(params: { amount: number; currency: string; metadata: Record<string, string> }): Promise<Stripe.PaymentIntent> {
    return this.call(() => this.stripe.paymentIntents.create({
      amount: params.amount,
      currency: params.currency.toLowerCase(),
      metadata: params.metadata,
      // No redirect-based methods, so the frontend needs no return_url.
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    }));
  }

  retrievePaymentIntent(id: string): Promise<Stripe.PaymentIntent> {
    return this.call(() => this.stripe.paymentIntents.retrieve(id));
  }

  cancelPaymentIntent(id: string): Promise<Stripe.PaymentIntent> {
    return this.call(() => this.stripe.paymentIntents.cancel(id));
  }

  createRefund(params: { paymentIntentId: string; amount: number; metadata: Record<string, string> }, idempotencyKey: string): Promise<Stripe.Refund> {
    return this.call(() => this.stripe.refunds.create(
      { payment_intent: params.paymentIntentId, amount: params.amount, metadata: params.metadata },
      { idempotencyKey },
    ));
  }

  retrieveRefund(id: string): Promise<Stripe.Refund> {
    return this.call(() => this.stripe.refunds.retrieve(id));
  }

  /** Every refund of a PaymentIntent (a payment never has more than a few). */
  async listRefunds(paymentIntentId: string): Promise<Stripe.Refund[]> {
    const list = await this.call(() => this.stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 }));
    return list.data;
  }

  /** 400 unless Stripe signed this exact body with our webhook secret (within its 5-minute tolerance). */
  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) throw new ServiceUnavailableException('STRIPE_WEBHOOK_SECRET is not configured');
    try {
      return Stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new BadRequestException('Invalid Stripe signature');
    }
  }

  // Created on first use, so the app and Swagger start without a Stripe key.
  private get stripe(): Stripe {
    if (!this.client) {
      const key = this.config.get<string>('STRIPE_SECRET_KEY');
      if (!key) throw new ServiceUnavailableException('STRIPE_SECRET_KEY is not configured');
      this.client = new Stripe(key);
    }
    return this.client;
  }

  // Stripe errors become 502 instead of a generic 500.
  private async call<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError) throw new BadGatewayException(`Stripe error: ${error.message}`);
      throw error;
    }
  }
}
