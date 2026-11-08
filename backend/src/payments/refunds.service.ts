import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { UserRole } from '../common/enums/user-role.enum';
import { bookingRef } from './booking-ref';
import { BookingType } from './bookings-port';
import { toMinorUnits } from './money';
import { PaymentStatus, RefundStatus } from './payment-status.enum';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import { Refund } from './schemas/refund.schema';
import { StripeService } from './stripe.service';

const DUPLICATE_KEY = 11000;
// Stripe metadata values are limited to 500 characters.
const STRIPE_METADATA_LIMIT = 500;
const DOUBLE_PAYMENT_REASON = 'Automatic refund: the booking was paid twice (an older payment attempt also succeeded)';

export interface CreateRefundInput {
  bookingType: BookingType;
  bookingId: string;
  amount: number; // Major units.
  reason: string;
}

/** Stripe refund status -> RefundStatus. Stripe's `canceled` counts as FAILED. */
export function toRefundStatus(status: string | null): RefundStatus {
  if (status === 'succeeded') return RefundStatus.REFUNDED;
  if (status === 'failed' || status === 'canceled') return RefundStatus.FAILED;
  return RefundStatus.PENDING;
}

@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    private readonly stripe: StripeService,
  ) {}

  /** PAY-03: reads a refund (owner or ADMIN). A PENDING one is checked with Stripe first. */
  async findOne(id: string, user: { userId: string; role: UserRole }) {
    const refund = await this.refunds.findById(id).exec();
    if (!refund || (refund.userId.toString() !== user.userId && user.role !== UserRole.ADMIN)) {
      throw new NotFoundException('Refund not found');
    }
    if (refund.status !== RefundStatus.PENDING) return refund;
    // Also covers a refund.updated webhook that arrived before this record was saved.
    try {
      await this.syncStripeRefund(await this.stripe.retrieveRefund(refund.stripeRefundId));
    } catch {
      // Stripe is unreachable: show the stored status instead of failing the read.
      this.logger.error(`Could not check refund ${id} with Stripe`);
      return refund;
    }
    return this.refunds.findById(id).exec();
  }

  /**
   * PAY-03 for the booking modules: refunds a cancelled booking. Idempotent per booking and reason,
   * because Person 4 retries failed requests: a repeated call returns the refund already created.
   */
  async refundCancelledBooking(input: CreateRefundInput) {
    const payment = await this.payments.findOne({ ...bookingRef(input.bookingType, input.bookingId), status: PaymentStatus.SUCCEEDED }).exec();
    // A refund Stripe made whose response or local save was lost is recorded first, so the retry finds it.
    if (payment) await this.reconcileWithStripe(payment);
    const existing = await this.refunds.findOne({
      ...bookingRef(input.bookingType, input.bookingId),
      reason: input.reason,
      status: { $in: [RefundStatus.PENDING, RefundStatus.REFUNDED] },
    }).exec();
    return existing ?? this.createRefund(input);
  }

  /** Refunds part or all of a booking's successful payment. */
  async createRefund(input: CreateRefundInput) {
    const { bookingType, bookingId, amount, reason } = input;
    const payment = await this.payments.findOne({ ...bookingRef(bookingType, bookingId), status: PaymentStatus.SUCCEEDED }).exec();
    if (!payment) throw new NotFoundException('No successful payment for this booking');
    if (!Number.isFinite(amount)) throw new BadRequestException('Refund amount must be a number');
    await this.reconcileWithStripe(payment);

    // Minor units, so 0.1 + 0.2 style float errors cannot matter.
    const amountMinor = toMinorUnits(amount);
    const remainingMinor = toMinorUnits(payment.amount) - await this.refundedSoFarMinor(payment);
    if (amountMinor <= 0) throw new BadRequestException('Refund amount must be greater than 0');
    if (amountMinor > remainingMinor) {
      throw new BadRequestException(`Refund amount is more than the refundable ${remainingMinor / 100} ${payment.currency}`);
    }

    // Same payment + same number of earlier attempts (failed ones too) + same amount = same key:
    // a duplicated call cannot refund twice, but a new try after a FAILED refund gets a fresh key.
    // The parameters only use stable values, because Stripe rejects a repeated key with different ones.
    const attempts = await this.refunds.countDocuments({ paymentId: payment._id }).exec();
    const stripeRefund = await this.stripe.createRefund(
      {
        paymentIntentId: payment.stripePaymentIntentId,
        amount: amountMinor,
        metadata: { paymentId: payment._id.toString(), bookingType, bookingId, reason: reason.slice(0, STRIPE_METADATA_LIMIT) },
      },
      `refund-${payment._id.toString()}-${attempts}-${amountMinor}`,
    );

    const existing = await this.refunds.findOne({ stripeRefundId: stripeRefund.id }).exec();
    if (existing) return existing;
    const refund = await this.refunds.create({
      userId: payment.userId,
      paymentId: payment._id,
      bookingType,
      ...bookingRef(bookingType, bookingId),
      amount: amountMinor / 100,
      currency: payment.currency,
      status: toRefundStatus(stripeRefund.status),
      stripeRefundId: stripeRefund.id,
      stripePaymentIntentId: payment.stripePaymentIntentId,
      reason,
    });
    await this.markPaymentRefundedIfComplete(payment._id);
    return refund;
  }

  /** Refunds of the payment itself, not of an extra, double-paid intent. */
  async hasRefunds(payment: PaymentDocument): Promise<boolean> {
    await this.reconcileWithStripe(payment);
    return await this.refunds.countDocuments(this.ownRefunds(payment)).exec() > 0;
  }

  /** A booking paid twice: an older intent succeeded after the payment was already SUCCEEDED. Refunded in full, once. */
  async refundExtraIntent(payment: PaymentDocument, intent: Stripe.PaymentIntent) {
    const existing = await this.refunds.findOne({ stripePaymentIntentId: intent.id }).exec();
    if (existing) return existing;
    // Stable parameters: a retry after a lost response replays the same Stripe refund.
    const stripeRefund = await this.stripe.createRefund(
      { paymentIntentId: intent.id, amount: intent.amount_received, metadata: { paymentId: payment._id.toString(), reason: DOUBLE_PAYMENT_REASON } },
      `refund-extra-${intent.id}`,
    );
    const replayed = await this.refunds.findOne({ stripeRefundId: stripeRefund.id }).exec();
    if (replayed) return replayed;
    return this.refunds.create({
      userId: payment.userId,
      paymentId: payment._id,
      bookingType: payment.bookingType,
      flightBookingId: payment.flightBookingId,
      hotelBookingId: payment.hotelBookingId,
      amount: intent.amount_received / 100,
      currency: intent.currency.toUpperCase(),
      status: toRefundStatus(stripeRefund.status),
      stripeRefundId: stripeRefund.id,
      stripePaymentIntentId: intent.id,
      reason: DOUBLE_PAYMENT_REASON,
    });
  }

  /**
   * Records refunds Stripe made for this payment that have no local row: the Stripe response or the
   * local save was lost. Without this a retry would not see them and could refund again.
   */
  private async reconcileWithStripe(payment: PaymentDocument): Promise<void> {
    const stripeRefunds = await this.stripe.listRefunds(payment.stripePaymentIntentId);
    for (const stripeRefund of stripeRefunds) {
      if (stripeRefund.metadata?.paymentId !== payment._id.toString()) continue;
      if (await this.refunds.exists({ stripeRefundId: stripeRefund.id }).exec()) continue;
      try {
        await this.refunds.create({
          userId: payment.userId,
          paymentId: payment._id,
          bookingType: payment.bookingType,
          flightBookingId: payment.flightBookingId,
          hotelBookingId: payment.hotelBookingId,
          amount: stripeRefund.amount / 100,
          currency: stripeRefund.currency?.toUpperCase() ?? payment.currency,
          status: toRefundStatus(stripeRefund.status),
          stripeRefundId: stripeRefund.id,
          stripePaymentIntentId: payment.stripePaymentIntentId,
          reason: stripeRefund.metadata?.reason,
        });
      } catch (error) {
        // A parallel call recorded it first.
        if ((error as { code?: number }).code !== DUPLICATE_KEY) throw error;
      }
    }
    await this.markPaymentRefundedIfComplete(payment._id);
  }

  /** Webhook `refund.updated`. Only a PENDING refund changes, so old or repeated events cannot undo a final status. */
  async syncStripeRefund(stripeRefund: Stripe.Refund) {
    const refund = await this.refunds.findOneAndUpdate(
      { stripeRefundId: stripeRefund.id, status: RefundStatus.PENDING },
      { status: toRefundStatus(stripeRefund.status) },
      { returnDocument: 'after' },
    ).exec();
    // TODO(Person 2): notify the user when a refund completes, once NotificationsService exists.
    if (refund) await this.markPaymentRefundedIfComplete(refund.paymentId);
  }

  /** Webhook `charge.refunded`. The event does not reliably include the refunds, so they are listed from Stripe. */
  async syncChargeRefunds(charge: Stripe.Charge) {
    const intent = charge.payment_intent;
    const intentId = typeof intent === 'string' ? intent : intent?.id;
    if (!intentId) return;
    for (const stripeRefund of await this.stripe.listRefunds(intentId)) {
      await this.syncStripeRefund(stripeRefund);
    }
  }

  // A payment becomes REFUNDED only when the whole amount came back.
  private async markPaymentRefundedIfComplete(paymentId: Types.ObjectId) {
    const payment = await this.payments.findById(paymentId).exec();
    if (!payment) return;
    const refunded = await this.refunds.find({ ...this.ownRefunds(payment), status: RefundStatus.REFUNDED }).exec();
    const refundedMinor = refunded.reduce((sum, refund) => sum + toMinorUnits(refund.amount), 0);
    if (refundedMinor >= toMinorUnits(payment.amount)) {
      await this.payments.updateOne({ _id: paymentId, status: PaymentStatus.SUCCEEDED }, { status: PaymentStatus.REFUNDED }).exec();
    }
  }

  // Money already refunded or on its way back; failed refunds do not count.
  private async refundedSoFarMinor(payment: PaymentDocument): Promise<number> {
    const refunds = await this.refunds.find({ ...this.ownRefunds(payment), status: { $in: [RefundStatus.PENDING, RefundStatus.REFUNDED] } }).exec();
    return refunds.reduce((sum, refund) => sum + toMinorUnits(refund.amount), 0);
  }

  private ownRefunds(payment: PaymentDocument) {
    return { paymentId: payment._id, stripePaymentIntentId: payment.stripePaymentIntentId };
  }
}
