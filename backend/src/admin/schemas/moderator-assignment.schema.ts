import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ModeratorAssignmentDocument = HydratedDocument<ModeratorAssignment>;

/**
 * ACC-13: links one moderator to exactly one airline or hotel. The collection and field
 * names are a team contract: AirlinesService.getAssignedAirlineId and
 * HotelsService.getAssignedHotelId already read moderatorassignments by moderatorId.
 */
@Schema({ collection: 'moderatorassignments', timestamps: true, versionKey: false })
export class ModeratorAssignment {
  declare _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  moderatorId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Airline' })
  airlineId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Hotel' })
  hotelId?: Types.ObjectId;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const ModeratorAssignmentSchema = SchemaFactory.createForClass(ModeratorAssignment);
// One assignment per moderator. A provider may have several moderators.
ModeratorAssignmentSchema.index({ moderatorId: 1 }, { unique: true, name: 'moderatorassignments_one_per_moderator' });
ModeratorAssignmentSchema.index({ airlineId: 1 }, { name: 'moderatorassignments_by_airline', sparse: true });
ModeratorAssignmentSchema.index({ hotelId: 1 }, { name: 'moderatorassignments_by_hotel', sparse: true });
ModeratorAssignmentSchema.pre('validate', function exactlyOneProvider() {
  if (Boolean(this.airlineId) === Boolean(this.hotelId)) {
    throw new Error('A moderator assignment needs exactly one of airlineId or hotelId');
  }
});
