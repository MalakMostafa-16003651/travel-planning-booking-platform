import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export enum CabinClass {
  ECONOMY = 'ECONOMY',
  PREMIUM_ECONOMY = 'PREMIUM_ECONOMY',
  BUSINESS = 'BUSINESS',
  FIRST = 'FIRST',
}

export type CabinInventoryDocument = HydratedDocument<CabinInventory>;

@Schema({ collection: 'cabininventories', timestamps: true, versionKey: false })
export class CabinInventory {
  declare _id: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Flight', required: true, index: true }) flightId!: Types.ObjectId;
  @Prop({ type: String, enum: CabinClass, required: true }) cabinClass!: CabinClass;
  @Prop({ type: Number, required: true, min: 1, validate: Number.isSafeInteger }) totalSeats!: number;
  @Prop({ type: Number, required: true, min: 0, default: 0, validate: Number.isSafeInteger }) bookedSeats!: number;
  @Prop({ type: Number, required: true, min: 0, default: 0, validate: Number.isSafeInteger }) heldSeats!: number;
  /** Integer minor units (e.g. 12500 = 125.00); shared currency is decided with Person 8. */
  @Prop({ type: Number, required: true, min: 1, validate: Number.isSafeInteger }) price!: number;
  @Prop({ type: Number, required: true, min: 0, validate: Number.isSafeInteger }) baggageAllowanceCount!: number;
  @Prop({ type: Number, required: true, min: 0.1 }) baggageMaxWeightKg!: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export const CabinInventorySchema = SchemaFactory.createForClass(CabinInventory);
CabinInventorySchema.index({ flightId: 1, cabinClass: 1 }, { unique: true, name: 'flight_cabin_class_unique' });
