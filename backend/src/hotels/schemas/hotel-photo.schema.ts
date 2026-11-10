import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type HotelPhotoDocument = HydratedDocument<HotelPhoto>;

/**
 * HTL-01/HTL-02/GEN-08 image bytes, kept out of the hotel document so hotels stay small.
 * Its _id is the photoId listed on the hotel. Served by GET /api/hotels/:id/photos/:photoId.
 */
@Schema({ timestamps: true, versionKey: false, collection: 'hotelphotos' })
export class HotelPhoto {
  declare _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Hotel', required: true, index: true })
  hotelId!: Types.ObjectId;

  @Prop({ type: Buffer, required: true })
  data!: Buffer;

  @Prop({ type: String, required: true, enum: ['image/jpeg', 'image/png'] })
  contentType!: string;

  @Prop({ type: Number, required: true, min: 1 })
  size!: number;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const HotelPhotoSchema = SchemaFactory.createForClass(HotelPhoto);
