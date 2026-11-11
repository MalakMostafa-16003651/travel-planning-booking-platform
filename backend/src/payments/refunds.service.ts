import { FlightBookingChangesStore } from '../flight-bookings/flight-booking-changes.store';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { isValidObjectId, Model, Types } from 'mongoose';
import Stripe from 'stripe';
import { UserRole } from '../common/enums/user-role.enum';
import { NotificationType } from '../notifications/notification-type.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { bookingRef } from './booking-ref';
import { BookingType } from './bookings-port';
import { toMinorUnits } from './money';
import { PaymentStatus, RefundStatus } from './payment-status.enum';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import { Refund, RefundDocument } from './schemas/refund.schema';
import { StripeService } from './stripe.service';

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

// Stripe requires every parameter, including metadata, to match when a key is retried.
// Derive the local ID from that same key so a lost response/persistence failure is recoverable.
function refundIdForKey(key: string): Types.ObjectId {
  return new Types.ObjectId(createHash('sha256').update(key).digest('hex').slice(0, 24));
}

@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    private readonly stripe: StripeService,
    private readonly notifications: NotificationsService,
    private readonly changes: FlightBookingChangesStore,
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
    if (input.bookingType === 'flight' && await this.changes.changes.exists({ flightBookingId: new Types.ObjectId(input.bookingId), status: BookingStatus.CONFIRMED })) {
      // Finish older fare reductions before cancellation refunds.
      if (!input.reason.startsWith('Flight fare decrease ')) {
        const due = await this.changes.changes.find({ flightBookingId: new Types.ObjectId(input.bookingId), status: BookingStatus.CONFIRMED, refundDue: true }).sort({ appliedAt: 1, _id: 1 }).exec();
        for (const change of due) {
          const refund = await this.refundFlightLedger({ bookingType: 'flight', bookingId: input.bookingId, amount: -change.differenceAmount / 100, reason: 'Flight fare decrease ' + change._id.toString() });
          if (refund.status === RefundStatus.FAILED) throw new BadRequestException('Fare decrease refund failed; retry is due');
          await this.changes.changes.updateOne({ _id: change._id }, { $set: { refundDue: false } }).exec();
        }
      }
      return this.refundFlightLedger(input);
    }
    const existing = await this.refunds.findOne({
      ...bookingRef(input.bookingType, input.bookingId),
      reason: input.reason,
      status: { $in: [RefundStatus.PENDING, RefundStatus.REFUNDED] },
    }).exec();
    return existing ?? this.createRefund(input);
  }

  /**
   * PAY-03 for the booking details pages (Persons 4 and 6): the booking's latest refund. A PENDING one
   * is checked with Stripe first; if Stripe is unreachable the stored status is returned.
   */
  async findLatestForBooking(bookingType: BookingType, bookingId: string, reason?: string) {
    if (!isValidObjectId(bookingId)) return null;
    const refund = await this.refunds.findOne({ ...bookingRef(bookingType, bookingId), ...(reason ? { reason } : {}) }).sort({ createdAt: -1, _id: -1 }).exec();
    if (!refund || refund.status !== RefundStatus.PENDING) return refund && bookingType === 'flight' ? this.aggregateReason(refund) : refund;
    try {
      await this.syncStripeRefund(await this.stripe.retrieveRefund(refund.stripeRefundId));
    } catch {
      this.logger.error(`Could not check refund ${refund._id.toString()} with Stripe`);
      return bookingType === 'flight' ? this.aggregateReason(refund) : refund;
    }
    const latest = await this.refunds.findById(refund._id).orFail().exec();
    return bookingType === 'flight' ? this.aggregateReason(latest) : latest;
  }

  private async aggregateReason(latest: RefundDocument) {
    const group = await this.refunds.find({ flightBookingId: latest.flightBookingId, reason: latest.reason }).sort({ createdAt: -1, _id: -1 }).exec();
    const byPayment = new Map<string, RefundDocument>();
    for (const row of group) { const key = row.paymentId.toString(); const old = byPayment.get(key); if (!old || (old.status === RefundStatus.FAILED && row.status !== RefundStatus.FAILED)) byPayment.set(key,row); }
    const rows = [...byPayment.values()];
    return { ...latest.toObject(), amount: rows.reduce((sum,r)=>sum+toMinorUnits(r.amount),0)/100,
      status: rows.some(r=>r.status===RefundStatus.FAILED) ? RefundStatus.FAILED : rows.some(r=>r.status===RefundStatus.PENDING) ? RefundStatus.PENDING : RefundStatus.REFUNDED };
  }

  /** One deterministic allocation per reason across the original capture and applied changes. */
  private async refundFlightLedger(input: CreateRefundInput): Promise<RefundDocument> {
    const applied = await this.changes.changes.find({ flightBookingId: new Types.ObjectId(input.bookingId), status: BookingStatus.CONFIRMED }).select('_id').lean().exec();
    const receipts = await this.payments.find({ status: { $in: [PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED] },
      $or: [{ flightBookingId: new Types.ObjectId(input.bookingId) }, { flightBookingChangeId: { $in: applied.map(c=>c._id) } }] }).sort({ createdAt: 1, _id: 1 }).exec();
    let remaining = toMinorUnits(input.amount);
    if (!Number.isSafeInteger(remaining) || remaining <= 0) throw new BadRequestException('Refund amount must be positive minor units');
    let result: RefundDocument | undefined;
    for (const payment of receipts) {
      const previous = await this.refunds.find({ ...this.ownRefunds(payment), status: { $in: [RefundStatus.PENDING, RefundStatus.REFUNDED] } }).exec();
      const forReason = previous.filter(r=>r.reason===input.reason);
      const elsewhere = previous.filter(r=>r.reason!==input.reason).reduce((sum,r)=>sum+toMinorUnits(r.amount),0);
      const target = Math.min(remaining, Math.max(0,toMinorUnits(payment.amount)-elsewhere));
      if (!target) continue;
      const already = forReason.reduce((sum,r)=>sum+toMinorUnits(r.amount),0);
      if (already && already !== target) throw new BadRequestException('Refund allocation needs reconciliation');
      if (already) result = forReason[0];
      else result = await this.refundReceipt(payment, { ...input, amount: target/100 }, true);
      remaining -= target;
      if (!remaining) break;
    }
    if (remaining || !result) throw new BadRequestException('Captured receipts do not cover the refund');
    return result;
  }

  /** Refunds part or all of a booking's successful payment. */
  async createRefund(input: CreateRefundInput) {
    const { bookingType, bookingId, amount, reason } = input;
    const payment = await this.payments.findOne({ ...bookingRef(bookingType, bookingId), status: PaymentStatus.SUCCEEDED }).exec();
    if (!payment) throw new NotFoundException('No successful payment for this booking');
    return this.refundReceipt(payment, input);
  }

  private async refundReceipt(payment: PaymentDocument, input: CreateRefundInput, ledger = false) {
    const { bookingType, bookingId, amount, reason } = input;
    if (ledger) {
      const prior = await this.refunds.findOne({ ...this.ownRefunds(payment), reason, status: { $in: [RefundStatus.PENDING, RefundStatus.REFUNDED] } }).exec();
      if (prior) { if (toMinorUnits(prior.amount) !== toMinorUnits(amount)) throw new BadRequestException('Refund allocation needs reconciliation'); return prior; }
    }
    if (!Number.isFinite(amount)) throw new BadRequestException('Refund amount must be a number');

    // Minor units, so 0.1 + 0.2 style float errors cannot matter.
    const amountMinor = toMinorUnits(amount);
    const remainingMinor = toMinorUnits(payment.amount) - await this.refundedSoFarMinor(payment);
    if (amountMinor <= 0) throw new BadRequestException('Refund amount must be greater than 0');
    if (amountMinor > remainingMinor) {
      throw new BadRequestException(`Refund amount is more than the refundable ${remainingMinor / 100} ${payment.currency}`);
    }

    // Same payment + same number of earlier attempts (failed ones too) + same amount = same key:
    // a duplicated call cannot refund twice, but a new try after a FAILED refund gets a fresh key.
    const attempts = await this.refunds.countDocuments({ paymentId: payment._id, ...(ledger ? { reason, status: RefundStatus.FAILED } : {}) }).exec();
    const idempotencyKey = ledger
      ? 'refund-ledger-' + payment._id.toString() + '-' + createHash('sha256').update(reason).digest('hex').slice(0,16) + '-' + attempts + '-' + amountMinor
      : `refund-${payment._id.toString()}-${attempts}-${amountMinor}`;
    const refundId = refundIdForKey(idempotencyKey);
    const stripeRefund = await this.stripe.createRefund(
      {
        paymentIntentId: payment.stripePaymentIntentId,
        amount: amountMinor,
        metadata: { refundId: refundId.toString(), paymentId: payment._id.toString(), bookingType, bookingId },
      },
      idempotencyKey,
    );

    const { refund, created } = await this.storeRefund({
      _id: refundId,
      userId: payment.userId,
      paymentId: payment._id,
      bookingType,
      ...bookingRef(bookingType, bookingId),
      ...(payment.flightBookingChangeId ? { flightBookingChangeId: payment.flightBookingChangeId } : {}),
      amount: amountMinor / 100,
      currency: payment.currency,
      status: toRefundStatus(stripeRefund.status),
      stripeRefundId: stripeRefund.id,
      stripePaymentIntentId: payment.stripePaymentIntentId,
      reason,
    });
    // Stripe can finish a refund at once; otherwise refund.updated notifies later.
    if (created) await this.notifyIfFinal(refund);
    await this.markPaymentRefundedIfComplete(payment._id);
    return refund;
  }

  /** Refunds of the payment itself, not of an extra, double-paid intent. */
  async hasRefunds(payment: PaymentDocument): Promise<boolean> {
    return await this.refunds.countDocuments({ ...this.ownRefunds(payment), status: { $in: [RefundStatus.PENDING, RefundStatus.REFUNDED] } }).exec() > 0;
  }

  /** A booking paid twice: an older intent succeeded after the payment was already SUCCEEDED. Refunded in full, once. */
  async refundExtraIntent(payment: PaymentDocument, intent: Stripe.PaymentIntent) {
    const existing = await this.refunds.findOne({ stripePaymentIntentId: intent.id }).exec();
    if (existing) return existing;
    const idempotencyKey = `refund-extra-${intent.id}`;
    const refundId = refundIdForKey(idempotencyKey);
    const stripeRefund = await this.stripe.createRefund(
      { paymentIntentId: intent.id, amount: intent.amount_received, metadata: { refundId: refundId.toString(), paymentId: payment._id.toString() } },
      idempotencyKey,
    );
    const { refund, created } = await this.storeRefund({
      _id: refundId,
      userId: payment.userId,
      paymentId: payment._id,
      bookingType: payment.bookingType,
      flightBookingId: payment.flightBookingId,
      hotelBookingId: payment.hotelBookingId,
      flightBookingChangeId: payment.flightBookingChangeId,
      amount: intent.amount_received / 100,
      currency: intent.currency.toUpperCase(),
      status: toRefundStatus(stripeRefund.status),
      stripeRefundId: stripeRefund.id,
      stripePaymentIntentId: intent.id,
      reason: 'Automatic refund: the booking was paid twice (an older payment attempt also succeeded)',
    });
    if (created) await this.notifyIfFinal(refund);
    return refund;
  }

  /** Parallel deliveries can receive the same Stripe refund before either local insert completes. */
  // created is false when another call already stored this Stripe refund, so only one caller notifies.
  private async storeRefund(input: Partial<Refund> & { _id: Types.ObjectId; stripeRefundId: string }) {
    const existing = await this.refunds.findOne({ stripeRefundId: input.stripeRefundId }).exec();
    if (existing) return { refund: existing, created: false };
    try {
      return { refund: await this.refunds.create(input), created: true };
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const winner = await this.refunds.findOne({ stripeRefundId: input.stripeRefundId }).exec();
      if (!winner) throw error;
      return { refund: winner, created: false };
    }
  }

  /**
   * PAY-03 / GEN-01: the user is notified once, when a refund reaches its final status. Person 2's
   * service owns the notification; a failure to notify must not undo the refund, so it is only logged.
   */
  private async notifyIfFinal(refund: RefundDocument) {
    if (refund.status === RefundStatus.PENDING) return;
    const amount = `${refund.amount.toFixed(2)} ${refund.currency}`;
    const message = refund.status === RefundStatus.REFUNDED
      ? `Your refund of ${amount} has been completed.`
      : `Your refund of ${amount} could not be completed. Our team will follow up.`;
    try {
      await this.notifications.notify({ userId: refund.userId.toString(), type: NotificationType.REFUND_ISSUED, message });
    } catch {
      this.logger.error(`Could not notify the user about refund ${refund._id.toString()}`);
    }
  }

  /** Webhook `refund.updated`. Only a PENDING refund changes, so old or repeated events cannot undo a final status. */
  async syncStripeRefund(stripeRefund: Stripe.Refund) {
    const refund = await this.payments.db.transaction(async session => {
      const refund = await this.refunds.findOneAndUpdate(
      { stripeRefundId: stripeRefund.id, status: RefundStatus.PENDING },
      { status: toRefundStatus(stripeRefund.status) },
      { returnDocument: 'after', session },
    ).exec();
    if (!refund) return null;
    if (refund.status === RefundStatus.FAILED) {
      // Reopen durable obligations; a failed gateway refund is not money returned.
      await this.payments.updateOne({ _id: refund.paymentId, bookingConfirmedAt: null, stripePaymentIntentId: refund.stripePaymentIntentId }, { $unset: { autoRefundedAt: 1 } }, { session }).exec();
      if (refund.reason?.startsWith('Flight fare decrease ')) {
        const id = refund.reason.slice('Flight fare decrease '.length);
        if (isValidObjectId(id)) await this.changes.changes.updateOne({ _id: new Types.ObjectId(id), status: BookingStatus.CONFIRMED }, { $set: { refundDue: true } }, { session }).exec();
      } else if (refund.flightBookingId && ['Flight cancelled by the airline', 'Booking cancelled by the user'].includes(refund.reason ?? '')) {
        await this.payments.db.collection('flightbookings').updateOne({ _id: refund.flightBookingId, status: BookingStatus.CANCELLED }, { $set: { refundDue: true } }, { session });
      }
    }
    return refund;
    });
    if (!refund) {
      const existing = await this.refunds.findOne({ stripeRefundId: stripeRefund.id }).exec();
      if (existing) await this.markPaymentRefundedIfComplete(existing.paymentId);
      return;
    }
    // The status filter above lets exactly one delivery make this change, so the user is notified once.
    await this.notifyIfFinal(refund);
    await this.markPaymentRefundedIfComplete(refund.paymentId);
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
