import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { MAX_HOTEL_PHOTOS } from '../hotels.rules';

export type HotelDocument = HydratedDocument<Hotel>;

/** HTL-01/GEN-08: what the hotel lists about each photo. Its _id is the photoId of the HotelPhoto holding the bytes. */
@Schema({ _id: false, versionKey: false })
export class HotelPhotoRef {
  @Prop({ type: Types.ObjectId, required: true })
  _id!: Types.ObjectId;

  @Prop({ type: String, required: true })
  contentType!: string;

  @Prop({ type: Number, required: true })
  size!: number;

  @Prop({ type: Date, required: true })
  uploadedAt!: Date;
}

const HotelPhotoRefSchema = SchemaFactory.createForClass(HotelPhotoRef);

@Schema({ _id: false })
export class CancellationTier {
  @Prop({ type: Number, required: true, min: 0, validate: Number.isSafeInteger })
  daysBeforeCheckIn!: number;

  @Prop({ type: Number, required: true, min: 0, max: 100 })
  refundPercentage!: number;
}

export const CancellationTierSchema = SchemaFactory.createForClass(CancellationTier);

@Schema({ collection: 'hotels', timestamps: true, versionKey: false })
export class Hotel {
  declare _id: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, minlength: 2, maxlength: 150 })
  name!: string;

  /** Canonical city name from ReferenceDataService.resolveCity, matching the itinerary module's convention. */
  @Prop({ type: String, required: true, trim: true })
  city!: string;

  @Prop({ type: String, required: true, uppercase: true, match: /^[A-Z]{2}$/ })
  countryCode!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 300 })
  address!: string;

  @Prop({ type: String, trim: true, default: null, maxlength: 2000 })
  description?: string | null;

  /** ACC-15: a deactivated hotel is hidden from search/booking but keeps its existing confirmed reservations. */
  @Prop({ type: Boolean, required: true, default: true })
  isActive!: boolean;

  @Prop({ type: String, required: true, default: '14:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ })
  checkInTime!: string;

  @Prop({ type: String, required: true, default: '11:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ })
  checkOutTime!: string;

  @Prop({ type: [CancellationTierSchema], default: [] })
  cancellationTiers!: CancellationTier[];

  @Prop({
    type: [HotelPhotoRefSchema],
    default: [],
    validate: { validator: (photos: HotelPhotoRef[]) => photos.length <= MAX_HOTEL_PHOTOS, message: `A hotel can have at most ${MAX_HOTEL_PHOTOS} photos` },
  })
  photos!: HotelPhotoRef[];

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const HotelSchema = SchemaFactory.createForClass(Hotel);
