import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BookingStatus } from '../../common/enums/booking-status.enum';

export enum PassengerType {
  ADULT = 'ADULT',
  CHILD = 'CHILD',
  INFANT = 'INFANT',
}

export enum CancelledBy {
  USER = 'USER',
  AIRLINE = 'AIRLINE',
}

/** Copied at hold time so later price edits cannot change a booking (FLT-05). */
@Schema({ _id: false })
export class FlightSegment {
  @Prop({ type: Types.ObjectId, required: true })
  flightId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  airlineId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  cabinId!: Types.ObjectId;

  @Prop({ required: true })
  cabinClass!: string;

  @Prop({ type: Number, min: 0 })
  baggageAllowanceCount?: number;

  @Prop({ type: Number, min: 0 })
  baggageMaxWeightKg?: number;

  /** Adult/child fare in minor currency units. */
  @Prop({ required: true, min: 0 })
  fare!: number;

  @Prop({ required: true })
  flightNumber!: string;

  @Prop({ required: true })
  departureAirportCode!: string;

  @Prop({ required: true })
  arrivalAirportCode!: string;

  @Prop({ type: Date, required: true })
  departureAt!: Date;

  @Prop({ type: Date, required: true })
  arrivalAt!: Date;

  @Prop({ required: true })
  departureTimeZone!: string;

  @Prop({ required: true })
  arrivalTimeZone!: string;
}

@Schema()
export class Passenger {
  declare _id: Types.ObjectId;

  @Prop({ required: true, trim: true })
  fullName!: string;

  @Prop({ type: Date, required: true })
  dateOfBirth!: Date;

  @Prop({ required: true })
  documentNumber!: string;

  @Prop({ type: String, enum: PassengerType, required: true })
  type!: PassengerType;

  @Prop({ default: 0, min: 0 })
  extraBags!: number;

  /** Combined weight of this passenger's extra bags. */
  @Prop({ default: 0, min: 0 })
  extraBaggageWeightKg!: number;
}

export type FlightBookingDocument = HydratedDocument<FlightBooking>;

@Schema({ timestamps: true, versionKey: false })
export class FlightBooking {
  declare _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: [SchemaFactory.createForClass(FlightSegment)], required: true })
  segments!: FlightSegment[];

  @Prop({ type: [SchemaFactory.createForClass(Passenger)], required: true })
  passengers!: Passenger[];

  /** Adults and children; infants occupy no seat (FLT-12). */
  @Prop({ required: true, min: 1 })
  seatCount!: number;

  @Prop({ required: true, min: 0 })
  baggageFee!: number;

  @Prop({ required: true, min: 0 })
  totalAmount!: number;

  @Prop({ required: true })
  currency!: string;

  @Prop({ type: String, enum: BookingStatus, default: BookingStatus.PENDING, required: true })
  status!: BookingStatus;

  @Prop({ type: Date })
  holdExpiresAt?: Date;

  /** Departure of the final segment; lets list queries group trips without loading them. */
  @Prop({ type: Date, required: true })
  lastDepartureAt!: Date;

  @Prop({ type: String })
  bookingReference?: string;

  @Prop({ type: Types.ObjectId, ref: 'Payment' })
  paymentId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Refund' })
  refundId?: Types.ObjectId;

  @Prop({ type: Date })
  cancelledAt?: Date;

  @Prop({ type: String, enum: CancelledBy })
  cancelledBy?: CancelledBy;

  @Prop({ type: Number, min: 0 })
  refundAmount?: number;

  /** True until Payments has accepted the refund, so a failed request is retried. */
  @Prop({ default: false })
  refundDue!: boolean;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const FlightBookingSchema = SchemaFactory.createForClass(FlightBooking);
FlightBookingSchema.index({ userId: 1, status: 1, lastDepartureAt: 1 });
FlightBookingSchema.index({ status: 1, holdExpiresAt: 1 });
FlightBookingSchema.index({ 'segments.flightId': 1, status: 1 });
FlightBookingSchema.index({ bookingReference: 1 }, { unique: true, sparse: true, name: 'flight_bookings_reference_unique' });
