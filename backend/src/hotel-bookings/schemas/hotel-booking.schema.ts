import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { CancellationTier, CancellationTierSchema } from '../../hotels/schemas/hotel.schema';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ONLY = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Who cancelled a Confirmed reservation (GEN-11: user or provider cancellation). */
export enum HotelBookingCancelledBy {
  USER = 'USER',
  HOTEL = 'HOTEL',
}

/** One booked room. Name and price are copied at hold time, so later room edits never change a reservation (HTL-05). */
@Schema({ _id: false })
export class HotelBookingRoom {
  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  roomId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  roomName!: string;

  /** Minor units (PAY-04). */
  @Prop({ type: Number, required: true, min: 1, validate: Number.isSafeInteger })
  pricePerNight!: number;

  @Prop({ type: Number, required: true, min: 0, validate: Number.isSafeInteger })
  adults!: number;

  /** HTL-16: children are aged 0-17. */
  @Prop({ type: [Number], default: [], validate: (ages: number[]) => ages.every((age) => Number.isInteger(age) && age >= 0 && age <= 17) })
  childrenAges!: number[];

  /** nights x pricePerNight, minor units. */
  @Prop({ type: Number, required: true, min: 0, validate: Number.isSafeInteger })
  subtotal!: number;
}

export const HotelBookingRoomSchema = SchemaFactory.createForClass(HotelBookingRoom);

/** The hotel policy shown before payment (PAY-02), copied at hold time. */
@Schema({ _id: false })
export class HotelPolicySnapshot {
  @Prop({ type: [CancellationTierSchema], default: [] })
  cancellationTiers!: CancellationTier[];

  @Prop({ type: String, required: true, match: TIME_ONLY })
  checkInTime!: string;

  @Prop({ type: String, required: true, match: TIME_ONLY })
  checkOutTime!: string;
}

export const HotelPolicySnapshotSchema = SchemaFactory.createForClass(HotelPolicySnapshot);

export type HotelBookingDocument = HydratedDocument<HotelBooking>;

/** HTL-16..21, GEN-11. One reservation: one hotel, the same dates for every room. */
@Schema({ collection: 'hotelbookings', timestamps: true, versionKey: false })
export class HotelBooking {
  declare _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  /** Top level so the ACC-15 and HTL-22 queries can filter on it. */
  @Prop({ type: Types.ObjectId, ref: 'Hotel', required: true })
  hotelId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  hotelName!: string;

  @Prop({ type: [HotelBookingRoomSchema], required: true, validate: (rooms: HotelBookingRoom[]) => rooms.length > 0 })
  rooms!: HotelBookingRoom[];

  /** Half-open stay [checkIn, checkOut), the same convention as RoomAvailability. */
  @Prop({ type: String, required: true, match: DATE_ONLY })
  checkIn!: string;

  @Prop({ type: String, required: true, match: DATE_ONLY })
  checkOut!: string;

  @Prop({ type: Number, required: true, min: 1, validate: Number.isSafeInteger })
  nights!: number;

  /** Sum of rooms[].subtotal, minor units. */
  @Prop({ type: Number, required: true, min: 0, validate: Number.isSafeInteger })
  totalPrice!: number;

  /** Single platform currency (PAY-04). */
  @Prop({ type: String, required: true })
  currency!: string;

  @Prop({ type: String, enum: BookingStatus, default: BookingStatus.PENDING, required: true })
  status!: BookingStatus;

  /** Set while PENDING: hold time + 10 minutes (HTL-18). */
  @Prop({ type: Date })
  holdExpiresAt?: Date;

  /** Generated on confirmation only (HTL-17). */
  @Prop({ type: String })
  bookingReference?: string;

  @Prop({ type: Types.ObjectId, ref: 'Payment' })
  paymentId?: Types.ObjectId;

  @Prop({ type: HotelPolicySnapshotSchema, required: true })
  policySnapshot!: HotelPolicySnapshot;

  @Prop({ type: Date })
  cancelledAt?: Date;

  @Prop({ type: String, enum: HotelBookingCancelledBy })
  cancelledBy?: HotelBookingCancelledBy;

  /** Minor units. */
  @Prop({ type: Number, min: 0 })
  refundAmount?: number;

  /** True until Payments has accepted the refund, so a failed request is retried. */
  @Prop({ type: Boolean, default: false })
  refundDue!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Refund' })
  refundId?: Types.ObjectId;

  /** Set when the stay is marked COMPLETED (GEN-11). */
  @Prop({ type: Date })
  completedAt?: Date;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const HotelBookingSchema = SchemaFactory.createForClass(HotelBooking);
HotelBookingSchema.index({ userId: 1, status: 1, checkIn: 1 });
HotelBookingSchema.index({ hotelId: 1, status: 1, checkIn: 1 });
HotelBookingSchema.index({ status: 1, holdExpiresAt: 1 });
HotelBookingSchema.index({ status: 1, checkIn: 1 });
HotelBookingSchema.index({ 'rooms.roomId': 1, status: 1 });
HotelBookingSchema.index({ bookingReference: 1 }, { unique: true, sparse: true, name: 'hotel_bookings_reference_unique' });
