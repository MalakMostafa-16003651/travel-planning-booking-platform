import { hideBookingVersion } from '../../common/booking-gate';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type RoomDocument = HydratedDocument<Room>;

@Schema({ collection: 'rooms', timestamps: true, versionKey: false })
export class Room {
  declare _id: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Hotel', required: true, index: true })
  hotelId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, minlength: 1, maxlength: 120 })
  name!: string;

  @Prop({ type: String, trim: true, minlength: 1, maxlength: 80 })
  type?: string;

  @Prop({ type: Number, min: 1, validate: Number.isSafeInteger })
  beds?: number;

  @Prop({ type: Number, required: true, min: 1, validate: Number.isSafeInteger })
  capacity!: number;

  /** Integer minor units of PLATFORM_CURRENCY ('USD', PAY-04), e.g. 12500 = $125.00. Confirmed with Person 8; no currency field on the room, same as flights' CabinInventory.price. */
  @Prop({ type: Number, required: true, min: 1, validate: Number.isSafeInteger })
  pricePerNight!: number;

  /** HTL-06 "delete" is a soft deactivation, so a room kept by a past/eventual booking keeps a valid id. */
  @Prop({ type: Boolean, required: true, default: true })
  isActive!: boolean;

  /** Private concurrency gate shared with booking transactions. Never part of an API DTO. */
  @Prop({ type: Number, default: 0, select: false, min: 0, max: Number.MAX_SAFE_INTEGER, validate: Number.isSafeInteger })
  bookingVersion!: number;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const RoomSchema = SchemaFactory.createForClass(Room);
RoomSchema.set('toJSON', { transform: hideBookingVersion });
RoomSchema.set('toObject', { transform: hideBookingVersion });
// Legacy records are preserved; API transaction checks also protect names against legacy rows.
RoomSchema.index({ hotelId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { type: { $exists: true }, beds: { $exists: true } }, name: 'rooms_hotel_name_unique' });
