import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongoSchema, Types } from 'mongoose';
import { BookingStatus } from '../../common/enums/booking-status.enum';

@Schema({ _id: false })
export class ChangeInventoryHold {
  @Prop({ type: Types.ObjectId, required: true }) cabinId!: Types.ObjectId;
  @Prop({ type: Number, required: true, min: 1 }) seats!: number;
}
@Schema({ collection: 'flightbookingchanges', timestamps: true, versionKey: false })
export class FlightBookingChange {
  declare _id: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true, index: true }) userId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) flightBookingId!: Types.ObjectId;
  @Prop({ type: String, enum: BookingStatus, required: true, default: BookingStatus.PENDING }) status!: BookingStatus;
  @Prop({ type: MongoSchema.Types.Mixed, required: true }) previousSegments!: Record<string, any>[];
  @Prop({ required: true }) baseFingerprint!: string;
  @Prop({ type: MongoSchema.Types.Mixed, required: true }) proposed!: Record<string, any>;
  @Prop({ type: MongoSchema.Types.Mixed, required: true }) policies!: Record<string, any>;
  @Prop({ type: [SchemaFactory.createForClass(ChangeInventoryHold)], required: true }) holds!: ChangeInventoryHold[];
  @Prop({ required: true }) previousAmount!: number;
  @Prop({ required: true }) differenceAmount!: number;
  @Prop({ type: Date, required: true }) holdExpiresAt!: Date;
  @Prop({ type: Types.ObjectId }) paymentId?: Types.ObjectId;
  @Prop({ type: Date }) appliedAt?: Date;
  @Prop({ default: false }) refundDue!: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;
}
export type FlightBookingChangeDocument = HydratedDocument<FlightBookingChange>;
export const FlightBookingChangeSchema = SchemaFactory.createForClass(FlightBookingChange);
FlightBookingChangeSchema.index({ flightBookingId: 1 }, { unique: true, partialFilterExpression: { status: BookingStatus.PENDING }, name: 'one_pending_flight_change' });
FlightBookingChangeSchema.index({ status: 1, holdExpiresAt: 1 });
