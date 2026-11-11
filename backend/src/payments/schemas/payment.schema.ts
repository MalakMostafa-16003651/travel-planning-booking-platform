import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BOOKING_TYPES } from '../booking-ref';
import type { BookingType } from '../bookings-port';
import { PaymentStatus } from '../payment-status.enum';

export type PaymentDocument = HydratedDocument<Payment>;

/** One Payment per booking. Card data is never stored: Stripe holds it. */
@Schema({ timestamps: true, versionKey: false })
export class Payment {
  declare _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, enum: BOOKING_TYPES, required: true })
  bookingType!: BookingType;

  @Prop({ type: Types.ObjectId })
  flightBookingId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  hotelBookingId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  flightBookingChangeId?: Types.ObjectId;

  // Major units (e.g. 150.5), always copied from the booking.
  @Prop({ type: Number, required: true, min: 0 })
  amount!: number;

  @Prop({ type: String, required: true, uppercase: true })
  currency!: string;

  @Prop({ type: String, enum: PaymentStatus, default: PaymentStatus.PENDING, required: true })
  status!: PaymentStatus;

  // The current PaymentIntent; a retry replaces it.
  @Prop({ type: String, required: true })
  stripePaymentIntentId!: string;

  @Prop({ type: String })
  failureReason?: string;

  // What happened after the success, stored only once it really happened.
  @Prop({ type: Date })
  bookingConfirmedAt?: Date;

  @Prop({ type: Date })
  autoRefundedAt?: Date;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ stripePaymentIntentId: 1 }, { unique: true, name: 'payments_intent_unique' });
// At most one Payment per booking, even if two requests race.
PaymentSchema.index({ flightBookingId: 1 }, { unique: true, partialFilterExpression: { flightBookingId: { $exists: true } }, name: 'payments_flight_booking_unique' });
PaymentSchema.index({ hotelBookingId: 1 }, { unique: true, partialFilterExpression: { hotelBookingId: { $exists: true } }, name: 'payments_hotel_booking_unique' });

PaymentSchema.index({ flightBookingChangeId: 1 }, { unique: true, partialFilterExpression: { flightBookingChangeId: { $exists: true } }, name: 'payments_flight_change_unique' });
