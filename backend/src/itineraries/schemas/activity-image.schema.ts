import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ActivityImageDocument = HydratedDocument<ActivityImage>;

/**
 * ITN-12 image bytes, kept out of the itinerary document so itineraries stay small.
 * Replace with the team's shared media storage (GEN-08) once one is agreed.
 */
@Schema({ timestamps: true, versionKey: false, collection: 'activityimages' })
export class ActivityImage {
  declare _id: Types.ObjectId; // imageId, matches ActivityImageRef._id

  @Prop({ type: Types.ObjectId, required: true, index: true })
  itineraryId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  activityId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  contentType!: string;

  @Prop({ type: Buffer, required: true })
  data!: Buffer;

  declare createdAt: Date;
}

export const ActivityImageSchema = SchemaFactory.createForClass(ActivityImage);
