import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type FavoriteDocument = HydratedDocument<Favorite>;

/** BON-02: one private bookmark owned by a registered user. Never stores a target snapshot. */
@Schema({ collection: 'favorites', timestamps: true, versionKey: false })
export class Favorite {
  declare _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Hotel' })
  hotelId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Itinerary' })
  itineraryId?: Types.ObjectId;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const FavoriteSchema = SchemaFactory.createForClass(Favorite);
FavoriteSchema.pre('validate', function exactlyOneTarget() {
  if (Boolean(this.hotelId) === Boolean(this.itineraryId) || this.hotelId === null || this.itineraryId === null) {
    this.invalidate('hotelId', 'Exactly one of hotelId or itineraryId is required');
  }
});
FavoriteSchema.index({ userId: 1, hotelId: 1 }, {
  unique: true, partialFilterExpression: { hotelId: { $exists: true } }, name: 'favorites_unique_user_hotel',
});
FavoriteSchema.index({ userId: 1, itineraryId: 1 }, {
  unique: true, partialFilterExpression: { itineraryId: { $exists: true } }, name: 'favorites_unique_user_itinerary',
});
FavoriteSchema.index({ userId: 1, createdAt: -1, _id: -1 }, { name: 'favorites_owner_newest' });
