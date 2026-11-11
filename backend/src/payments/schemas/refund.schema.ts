import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BOOKING_TYPES } from '../booking-ref';
import type { BookingType } from '../bookings-port';
import { RefundStatus } from '../payment-status.enum';

export type RefundDocument = HydratedDocument<Refund>;

@Schema({ timestamps: true, versionKey: false })
export class Refund {
  declare _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Payment', required: true, index: true })
  paymentId!: Types.ObjectId;

  @Prop({ type: String, enum: BOOKING_TYPES, required: true })
  bookingType!: BookingType;

  @Prop({ type: Types.ObjectId })
  flightBookingId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  hotelBookingId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  flightBookingChangeId?: Types.ObjectId;

  // Major units, like Payment.amount.
  @Prop({ type: Number, required: true, min: 0 })
  amount!: number;

  @Prop({ type: String, required: true, uppercase: true })
  currency!: string;

  @Prop({ type: String, enum: RefundStatus, default: RefundStatus.PENDING, required: true })
  status!: RefundStatus;

  @Prop({ type: String, required: true })
  stripeRefundId!: string;

  // Where the money goes back: normally the payment's intent, an older one when a booking was paid twice.
  @Prop({ type: String, required: true })
  stripePaymentIntentId!: string;

  @Prop({ type: String })
  reason?: string;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const RefundSchema = SchemaFactory.createForClass(Refund);
RefundSchema.index({ stripeRefundId: 1 }, { unique: true, name: 'refunds_stripe_refund_unique' });
