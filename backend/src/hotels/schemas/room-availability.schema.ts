import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export enum BookedRangeStatus {
  HELD = 'HELD',
  BOOKED = 'BOOKED',
}

/** Moderator-set, HTL-04/05/06. Half-open: endDate is checkout, the night before is the last blocked night. */
@Schema()
export class BlockedRange {
  declare _id: Types.ObjectId;

  @Prop({ type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ })
  startDate!: string;

  @Prop({ type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ })
  endDate!: string;

  @Prop({ type: String, trim: true, maxlength: 200 })
  reason?: string;
}

export const BlockedRangeSchema = SchemaFactory.createForClass(BlockedRange);

/**
 * Written by the future hotel-bookings module (Person 6), never by this module. Defined here so the
 * collection/field shape is agreed up front, the same way the flight-booking contract fixed
 * CabinInventory's heldSeats/bookedSeats fields before FlightBookingsModule existed.
 */
@Schema()
export class BookedRange {
  declare _id: Types.ObjectId;

  @Prop({ type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ })
  startDate!: string;

  @Prop({ type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ })
  endDate!: string;

  @Prop({ type: String, enum: BookedRangeStatus, required: true })
  status!: BookedRangeStatus;

  @Prop({ type: Date })
  holdExpiresAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId })
  hotelBookingId?: Types.ObjectId;
}

export const BookedRangeSchema = SchemaFactory.createForClass(BookedRange);

export type RoomAvailabilityDocument = HydratedDocument<RoomAvailability>;

/**
 * One document per room (unique roomId), so a hold/release is a single conditional write instead
 * of a multi-document transaction. See docs/requirements/hotel-contract-proposal.md section 3.
 */
@Schema({ collection: 'roomavailabilities', timestamps: true, versionKey: false })
export class RoomAvailability {
  declare _id: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Room', required: true })
  roomId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Hotel', required: true, index: true })
  hotelId!: Types.ObjectId;

  @Prop({ type: [BlockedRangeSchema], default: [] })
  blockedRanges!: BlockedRange[];

  @Prop({ type: [BookedRangeSchema], default: [] })
  bookedRanges!: BookedRange[];

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const RoomAvailabilitySchema = SchemaFactory.createForClass(RoomAvailability);
RoomAvailabilitySchema.index({ roomId: 1 }, { unique: true, name: 'room_availability_room_unique' });
