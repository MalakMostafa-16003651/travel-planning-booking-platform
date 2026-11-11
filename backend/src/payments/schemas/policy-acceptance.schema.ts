import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { BOOKING_TYPES } from '../booking-ref';
import type { BookingType } from '../bookings-port';

export type PolicyAcceptanceDocument = HydratedDocument<PolicyAcceptance>;

/** PAY-02: proof that a user accepted a booking's policies before paying. */
@Schema({ timestamps: true, versionKey: false })
export class PolicyAcceptance {
  declare _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, enum: BOOKING_TYPES, required: true })
  bookingType!: BookingType;

  @Prop({ type: Types.ObjectId })
  flightBookingId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  hotelBookingId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId })
  flightBookingChangeId?: Types.ObjectId;

  // The policies the user saw, so a later provider change needs a new acceptance.
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  policies!: unknown;

  @Prop({ type: Date, required: true })
  acceptedAt!: Date;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const PolicyAcceptanceSchema = SchemaFactory.createForClass(PolicyAcceptance);
// One acceptance per user per booking; accepting again updates it.
PolicyAcceptanceSchema.index(
  { userId: 1, bookingType: 1, flightBookingId: 1, hotelBookingId: 1, flightBookingChangeId: 1 },
  { unique: true, name: 'policy_acceptances_target_unique' },
);

PolicyAcceptanceSchema.index({ userId: 1, flightBookingChangeId: 1 }, { unique: true, partialFilterExpression: { flightBookingChangeId: { $exists: true } }, name: 'policy_acceptances_change_unique' });
