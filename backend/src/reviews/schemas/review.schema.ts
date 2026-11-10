import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const REVIEW_COMMENT_MAX_LENGTH = 1000;

export const REVIEW_REPLY_MAX_LENGTH = 1000;

/** HTL-26 (bonus): the hotel's single public reply, written by a moderator assigned to that hotel. */
@Schema({ _id: false })
export class ReviewReply {
  @Prop({ type: String, required: true, trim: true, minlength: 1, maxlength: REVIEW_REPLY_MAX_LENGTH })
  text!: string;

  /** The replying HOTEL_MODERATOR (team naming: moderatorId). Not shown publicly. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  moderatorId!: Types.ObjectId;

  @Prop({ type: Date, required: true })
  repliedAt!: Date;

  /** Set when the moderator edits the reply. */
  @Prop({ type: Date })
  editedAt?: Date;
}

export const ReviewReplySchema = SchemaFactory.createForClass(ReviewReply);

export type ReviewDocument = HydratedDocument<Review>;

/** HTL-23/HTL-24. One rating and optional review per Completed hotel reservation. */
@Schema({ collection: 'reviews', timestamps: true, versionKey: false })
export class Review {
  declare _id: Types.ObjectId;

  /** The author (team ownership naming). */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Hotel', required: true })
  hotelId!: Types.ObjectId;

  /** Unique: one review per reservation, whatever the number of rooms (HTL-23). */
  @Prop({ type: Types.ObjectId, ref: 'HotelBooking', required: true })
  hotelBookingId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1, max: 5, validate: Number.isInteger })
  rating!: number;

  @Prop({ type: String, trim: true, maxlength: REVIEW_COMMENT_MAX_LENGTH, default: null })
  comment?: string | null;

  /** GEN-10: hidden by an admin. Visible only to its author and admins; never counted in ratings. */
  @Prop({ type: Boolean, required: true, default: false })
  isHidden!: boolean;

  /** HTL-26: at most one reply per review; null until the hotel replies. */
  @Prop({ type: ReviewReplySchema, default: null })
  reply?: ReviewReply | null;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);
ReviewSchema.index({ hotelBookingId: 1 }, { unique: true, name: 'reviews_hotel_booking_unique' });
ReviewSchema.index({ hotelId: 1, isHidden: 1, createdAt: -1 });
ReviewSchema.index({ userId: 1 });
