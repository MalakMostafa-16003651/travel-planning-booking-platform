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

  @Prop({ type: Number, required: true, min: 1, validate: Number.isSafeInteger })
  capacity!: number;

  /** Integer minor units of PLATFORM_CURRENCY ('USD', PAY-04), e.g. 12500 = $125.00. Confirmed with Person 8; no currency field on the room, same as flights' CabinInventory.price. */
  @Prop({ type: Number, required: true, min: 1, validate: Number.isSafeInteger })
  pricePerNight!: number;

  /** HTL-06 "delete" is a soft deactivation, so a room kept by a past/eventual booking keeps a valid id. */
  @Prop({ type: Boolean, required: true, default: true })
  isActive!: boolean;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const RoomSchema = SchemaFactory.createForClass(Room);
RoomSchema.index({ hotelId: 1 });
