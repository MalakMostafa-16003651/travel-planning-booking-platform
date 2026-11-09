import { EmailEligibilityService } from '../auth/email-eligibility.service';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import Stripe from 'stripe';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { UserRole } from '../common/enums/user-role.enum';
import { PLATFORM_CURRENCY } from '../flight-bookings/flight-booking.rules';
import { bookingRef, readBookingId } from './booking-ref';
import { BOOKINGS_PORT, type BookingsPort, BookingType, PayableBooking } from './bookings-port';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { roundMoney, toMinorUnits } from './money';
import { PaymentStatus } from './payment-status.enum';
import { PoliciesService } from './policies.service';
import { RefundsService } from './refunds.service';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import { StripeService } from './stripe.service';

type AuthUser = NonNullable<AuthenticatedRequest['user']>;

const DUPLICATE_KEY = 11000;

/** A FAILED payment with this reason was charged a wrong amount: an admin checks it in Stripe, and it is never retried. */
export const AMOUNT_MISMATCH_REASON = 'Paid amount does not match the booking amount';
export const HOLD_EXPIRED_REASON = 'The booking hold expired before the payment succeeded';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @Inject(BOOKINGS_PORT) private readonly bookingsPort: BookingsPort,
    private readonly policies: PoliciesService,
    private readonly refunds: RefundsService,
    private readonly stripe: StripeService,
    private readonly emailEligibility: EmailEligibilityService,
  ) {}

  /** PAY-01: starts paying for a booking. Returns the clientSecret for Stripe.js. */
  async create(dto: CreatePaymentDto, user: AuthUser) {
    await this.emailEligibility.assertCanBook(user.userId);
    const { bookingType, bookingId } = dto;
    const booking = await this.policies.getOwnedBooking(bookingType, bookingId, user.userId);
    this.assertPayable(booking);

    const existing = await this.payments.findOne(bookingRef(bookingType, bookingId)).exec();
    // A paid or failed payment answers 409 whatever the policies; a PENDING one is reused only while the
    // current policies are accepted, so a provider change after the first attempt needs a new acceptance.
    if (existing && existing.status !== PaymentStatus.PENDING) return this.reuseExisting(existing);
    await this.assertPoliciesAccepted(user.userId, bookingType, booking);
    await this.emailEligibility.assertCanBook(user.userId);
    if (existing) return this.reuseExisting(existing);

    // The id comes first so it can go into the PaymentIntent metadata.
    const paymentId = new Types.ObjectId();
    const amount = roundMoney(booking.totalPrice);
    const intent = await this.stripe.createPaymentIntent({
      amount: toMinorUnits(amount),
      currency: booking.currency,
      metadata: { paymentId: paymentId.toString(), bookingType, bookingId, userId: user.userId },
    });

    try {
      const payment = await this.payments.create({
        _id: paymentId,
        userId: new Types.ObjectId(user.userId),
        bookingType,
        ...bookingRef(bookingType, bookingId),
        amount,
        currency: booking.currency,
        status: PaymentStatus.PENDING,
        stripePaymentIntentId: intent.id,
      });
      // The clientSecret is returned once and never stored.
      return { payment, clientSecret: intent.client_secret };
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) throw new ConflictException('A payment for this booking is already in progress');
      throw error;
    }
  }

  /** PAY-01: tries again after a failed payment, on the same Payment record. */
  async retry(id: string, user: AuthUser) {
    await this.emailEligibility.assertCanBook(user.userId);
    const payment = await this.findOwnedPayment(id, user, false);
    if (payment.status !== PaymentStatus.FAILED) throw new ConflictException('Only a FAILED payment can be retried');
    if (payment.failureReason === AMOUNT_MISMATCH_REASON) {
      throw new ConflictException('This payment needs a manual check by an admin and cannot be retried');
    }
    const bookingType = payment.bookingType;
    const bookingId = readBookingId(payment);
    const booking = await this.bookingsPort.getBooking(bookingType, bookingId, payment.userId.toString());
    if (!booking) throw new NotFoundException('Booking not found');
    this.assertPayable(booking);
    await this.assertPoliciesAccepted(payment.userId.toString(), bookingType, booking);
    await this.emailEligibility.assertCanBook(user.userId);

    // The old intent must not be paid later by mistake. If cancelling fails, it may have been paid after all.
    try {
      await this.stripe.cancelPaymentIntent(payment.stripePaymentIntentId);
    } catch {
      const oldIntent = await this.stripe.retrievePaymentIntent(payment.stripePaymentIntentId);
      if (oldIntent.status === 'succeeded') {
        await this.applyIntentOutcome(oldIntent);
        throw new ConflictException('The previous payment attempt succeeded, no retry is needed');
      }
      if (oldIntent.status === 'processing') {
        throw new ConflictException('The previous payment attempt is still processing, try again later');
      }
    }

    await this.emailEligibility.assertCanBook(user.userId);
    const intent = await this.stripe.createPaymentIntent({
      amount: toMinorUnits(payment.amount),
      currency: payment.currency,
      metadata: { paymentId: payment._id.toString(), bookingType, bookingId, userId: payment.userId.toString() },
    });
    const updated = await this.payments.findOneAndUpdate(
      { _id: payment._id, status: PaymentStatus.FAILED },
      { $set: { status: PaymentStatus.PENDING, stripePaymentIntentId: intent.id }, $unset: { failureReason: 1 } },
      { returnDocument: 'after' },
    ).exec();
    if (!updated) throw new ConflictException('This payment was already retried');
    return { payment: updated, clientSecret: intent.client_secret };
  }

  /** PAY-01: reads a payment (owner or ADMIN). A PENDING one is checked with Stripe first. */
  async findOne(id: string, user: AuthUser) {
    const payment = await this.findOwnedPayment(id, user, true);
    if (payment.status !== PaymentStatus.PENDING) return payment;
    await this.applyIntentOutcome(await this.stripe.retrievePaymentIntent(payment.stripePaymentIntentId));
    return this.payments.findById(id).exec();
  }

  /** PAY-01: Stripe calls this. The signature proves the event is real. */
  async handleWebhook(rawBody: Buffer | undefined, signature?: string) {
    if (!rawBody || !signature) throw new BadRequestException('Missing Stripe signature');
    const event = this.stripe.constructWebhookEvent(rawBody, signature);

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handleIntentSucceeded(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await this.handleIntentFailed(event.data.object, event.data.object.last_payment_error?.message);
        break;
      case 'charge.refunded':
        await this.refunds.syncChargeRefunds(event.data.object);
        break;
      case 'refund.updated':
        await this.refunds.syncStripeRefund(event.data.object);
        break;
      default:
        // Acknowledged, so Stripe stops resending events we do not use.
        break;
    }
    return { received: true };
  }

  /**
   * PAY-01: the booking module calls this when a hold expires. The open PaymentIntent is cancelled so
   * it can no longer be paid. Succeeds when there is no payment. If Stripe already took the money,
   * the success is applied, which refunds it because the booking is no longer payable.
   */
  async cancelPendingPayment(bookingType: BookingType, bookingId: string): Promise<void> {
    const payment = await this.payments.findOne({ ...bookingRef(bookingType, bookingId), $or: [
      { status: { $in: [PaymentStatus.PENDING, PaymentStatus.FAILED] } },
      { status: PaymentStatus.SUCCEEDED, bookingConfirmedAt: null, autoRefundedAt: null },
    ] }).exec();
    if (!payment) return;
    if (payment.status === PaymentStatus.SUCCEEDED) {
      await this.finishSucceededPayment(payment);
      return;
    }
    try {
      await this.stripe.cancelPaymentIntent(payment.stripePaymentIntentId);
    } catch (error) {
      const intent = await this.stripe.retrievePaymentIntent(payment.stripePaymentIntentId);
      if (intent.status === 'succeeded') {
        await this.applyIntentOutcome(intent);
        return;
      }
      // Already cancelled (for example after a decline) is fine; anything else is retried by the caller.
      if (intent.status !== 'canceled') throw error;
    }
    await this.payments.updateOne(
      { _id: payment._id, status: { $in: [PaymentStatus.PENDING, PaymentStatus.FAILED] } },
      { status: PaymentStatus.FAILED, failureReason: HOLD_EXPIRED_REASON },
    ).exec();
  }

  /** Same rules as the webhook, for when we ask Stripe ourselves. */
  async applyIntentOutcome(intent: Stripe.PaymentIntent) {
    if (intent.status === 'succeeded') {
      await this.handleIntentSucceeded(intent);
    } else if (intent.status === 'canceled') {
      await this.handleIntentFailed(intent, 'Payment was canceled');
    } else if (intent.status === 'requires_payment_method' && intent.last_payment_error) {
      await this.handleIntentFailed(intent, intent.last_payment_error.message);
    }
  }

  private async handleIntentSucceeded(intent: Stripe.PaymentIntent) {
    const payment = await this.findPaymentForIntent(intent);
    if (!payment) {
      this.logger.warn(`Success for unknown PaymentIntent ${intent.id}`);
      return;
    }
    // An older intent of a retried payment was paid after all.
    const currentIntentId = payment.stripePaymentIntentId;
    const isOlderIntent = currentIntentId !== intent.id;
    const alreadyPaid = payment.status === PaymentStatus.SUCCEEDED || payment.status === PaymentStatus.REFUNDED;
    if (isOlderIntent && alreadyPaid) {
      await this.refundDoublePayment(payment, intent);
      return;
    }

    const amountMatches = intent.amount_received === toMinorUnits(payment.amount) && intent.currency === payment.currency.toLowerCase();
    if (!amountMatches) {
      this.logger.error(`Amount mismatch on payment ${payment._id.toString()}`);
      await this.payments.updateOne(
        { _id: payment._id, status: { $in: [PaymentStatus.PENDING, PaymentStatus.FAILED] } },
        { status: PaymentStatus.FAILED, failureReason: AMOUNT_MISMATCH_REASON },
      ).exec();
      return;
    }

    // The status filter makes this idempotent: a SUCCEEDED or REFUNDED payment is never touched again.
    const updated = await this.payments.findOneAndUpdate(
      { _id: payment._id, status: { $in: [PaymentStatus.PENDING, PaymentStatus.FAILED] } },
      { $set: { status: PaymentStatus.SUCCEEDED, stripePaymentIntentId: intent.id }, $unset: { failureReason: 1 } },
      { returnDocument: 'after' },
    ).exec();
    if (updated) {
      // The money came through the older intent, so the newer one must not be paid too.
      if (isOlderIntent) await this.stripe.cancelPaymentIntent(currentIntentId).catch(() => undefined);
      await this.finishSucceededPayment(updated);
      return;
    }
    // Another handler changed the payment since it was read. Decide from what is stored now, not from
    // that earlier read: the same intent won (a parallel delivery of this success), or another intent did.
    const latest = await this.payments.findById(payment._id).exec();
    if (!latest || (latest.status !== PaymentStatus.SUCCEEDED && latest.status !== PaymentStatus.REFUNDED)) return;
    if (latest.stripePaymentIntentId === intent.id) {
      // A redelivered or parallel success finishes whatever the first handler could not.
      await this.finishSucceededPayment(latest);
    } else {
      // A different intent of the same payment was paid: this one is a second charge.
      await this.refundDoublePayment(latest, intent);
    }
  }

  // Confirms the booking, or refunds in full when it is no longer payable. The outcome is stored only
  // after it happened, so a redelivered event can finish a confirmation or refund that crashed half way,
  // and a finished payment is never touched again (for example after the user cancelled).
  private async finishSucceededPayment(payment: PaymentDocument) {
    if (payment.bookingConfirmedAt || payment.autoRefundedAt) return;
    if (await this.confirmIfStillPayable(payment)) {
      // Person 4's confirmPaidBooking already notifies the user (FLT-23).
      await this.payments.updateOne({ _id: payment._id }, { bookingConfirmedAt: new Date() }).exec();
      return;
    }
    // Another delivery may have finalized confirmation while this handler awaited the booking.
    // Respect that durable marker before treating a later user cancellation as a failed payment.
    const latest = await this.payments.findById(payment._id).exec();
    if (!latest || latest.bookingConfirmedAt || latest.autoRefundedAt) return;
    // The money arrived, but the booking is gone, cancelled or its hold expired.
    if (!await this.refunds.hasRefunds(payment)) {
      const bookingId = readBookingId(payment);
      this.logger.warn(`Payment ${payment._id.toString()} succeeded but booking ${bookingId} is no longer payable: refunding`);
      await this.refunds.createRefund({
        bookingType: payment.bookingType,
        bookingId,
        amount: payment.amount,
        reason: 'Automatic refund: booking was no longer payable when the payment succeeded',
      });
    }
    await this.payments.updateOne({ _id: payment._id }, { autoRefundedAt: new Date() }).exec();
  }

  private async refundDoublePayment(payment: PaymentDocument, intent: Stripe.PaymentIntent) {
    this.logger.warn(`Payment ${payment._id.toString()} was paid twice (intent ${intent.id}): refunding that intent`);
    await this.refunds.refundExtraIntent(payment, intent);
  }

  // By intent id, or by our paymentId in its metadata (an older intent after a retry).
  private async findPaymentForIntent(intent: Stripe.PaymentIntent) {
    const payment = await this.payments.findOne({ stripePaymentIntentId: intent.id }).exec();
    const paymentId = intent.metadata?.paymentId;
    if (payment || !paymentId || !isValidObjectId(paymentId)) return payment;
    return this.payments.findById(paymentId).exec();
  }

  // True when the booking is (now) confirmed. There is one Payment per booking, so a CONFIRMED booking
  // was confirmed by this payment (for example before a crash).
  private async confirmIfStillPayable(payment: PaymentDocument) {
    const bookingType = payment.bookingType;
    const bookingId = readBookingId(payment);
    const userId = payment.userId.toString();
    const booking = await this.bookingsPort.getBooking(bookingType, bookingId, userId);
    if (booking?.status === BookingStatus.CONFIRMED) return true;
    if (!booking || !this.isPayable(booking)) return false;
    // ACC-02: keep historical confirmations; a newly ineligible paid hold follows the existing full-refund path.
    if (!await this.emailEligibility.canBook(userId)) return false;
    if (await this.bookingsPort.markConfirmed(bookingType, bookingId, payment._id.toString())) return true;
    // The booking changed meanwhile. If a parallel delivery of this success confirmed it, that is a success too.
    const latest = await this.bookingsPort.getBooking(bookingType, bookingId, userId);
    return latest?.status === BookingStatus.CONFIRMED;
  }

  private async handleIntentFailed(intent: Stripe.PaymentIntent, reason?: string) {
    // Only a PENDING payment can fail, so a late failure never undoes a success.
    const updated = await this.payments.findOneAndUpdate(
      { stripePaymentIntentId: intent.id, status: PaymentStatus.PENDING },
      { status: PaymentStatus.FAILED, failureReason: reason ?? 'Payment failed' },
      { returnDocument: 'after' },
    ).exec();
    if (updated) {
      // No notification: GEN-01 does not list payment failures and Person 2's types have none; the
      // failure is shown through the payment's FAILED status and failureReason (PAY-01).
      await this.bookingsPort.markPaymentFailed(updated.bookingType, readBookingId(updated), updated._id.toString());
    }
  }

  // A PENDING payment is returned again (same PaymentIntent) instead of creating a new one.
  private async reuseExisting(payment: PaymentDocument) {
    if (payment.status === PaymentStatus.PENDING) {
      const intent = await this.stripe.retrievePaymentIntent(payment.stripePaymentIntentId);
      return { payment, clientSecret: intent.client_secret };
    }
    if (payment.status === PaymentStatus.FAILED) {
      throw new ConflictException(`The last payment failed. Use POST /api/payments/${payment._id.toString()}/retry`);
    }
    throw new ConflictException('This booking is already paid');
  }

  // Another user's payment is 404, like other private resources.
  private async findOwnedPayment(id: string, user: AuthUser, allowAdmin: boolean) {
    const payment = await this.payments.findById(id).exec();
    const isOwner = payment?.userId.toString() === user.userId;
    const isAdmin = allowAdmin && user.role === UserRole.ADMIN;
    if (!payment || (!isOwner && !isAdmin)) throw new NotFoundException('Payment not found');
    return payment;
  }

  private isPayable(booking: PayableBooking): boolean {
    const expired = !!booking.holdExpiresAt && new Date(booking.holdExpiresAt).getTime() <= Date.now();
    return booking.status === BookingStatus.PENDING && !expired;
  }

  /** PAY-02: payment is blocked until the booking's current policies are accepted. */
  private async assertPoliciesAccepted(userId: string, bookingType: BookingType, booking: PayableBooking) {
    if (!await this.policies.hasAccepted(userId, bookingType, booking.bookingId, booking.policies)) {
      throw new ConflictException('Please accept the current booking policies before paying');
    }
  }

  private assertPayable(booking: PayableBooking) {
    // PAY-04: one platform currency for every price, payment and refund.
    if (booking.currency !== PLATFORM_CURRENCY) throw new ConflictException('The booking is not in the platform currency');
    if (booking.status !== BookingStatus.PENDING) throw new ConflictException('Only a PENDING booking can be paid');
    if (!this.isPayable(booking)) throw new ConflictException('The booking hold has expired');
    if (booking.checkoutReady === false) throw new ServiceUnavailableException('Hotel checkout is temporarily unavailable');
  }
}
