import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BudgetCategory, ItineraryVisibility, TransportMode } from '../itinerary.rules';

/*
 * Days, activities, budget entries and transport costs are bounded and owned by one
 * itinerary, so they are embedded (PDF section 5). One document write keeps day order,
 * numbering, dates, city grouping and budgets consistent; optimistic concurrency rejects
 * lost updates from two simultaneous edits.
 */

@Schema({ timestamps: true, versionKey: false })
export class ActivityImageRef {
  declare _id: Types.ObjectId; // exposed as imageId; bytes live in ActivityImage

  @Prop({ required: true })
  contentType!: string;

  @Prop({ required: true, min: 1 })
  size!: number;

  @Prop({ type: String })
  originalName?: string;

  declare createdAt: Date;
}
export const ActivityImageRefSchema = SchemaFactory.createForClass(ActivityImageRef);

@Schema({ timestamps: true, versionKey: false })
export class Activity {
  declare _id: Types.ObjectId; // activityId

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ type: String, trim: true })
  description?: string;

  @Prop({ type: String, trim: true })
  location?: string;

  /** Optional reference to the seeded attractions dataset. */
  @Prop({ type: String })
  attractionId?: string;

  /** Local time "HH:mm". */
  @Prop({ type: String })
  startTime?: string;

  @Prop({ type: String })
  endTime?: string;

  @Prop({ type: Number, min: 0 })
  cost?: number;

  @Prop({ type: String, match: /^[A-Z]{3}$/ })
  currency?: string;

  @Prop({ type: [ActivityImageRefSchema], default: [] })
  images!: ActivityImageRef[];

  declare createdAt: Date;
  declare updatedAt: Date;
}
export const ActivitySchema = SchemaFactory.createForClass(Activity);

@Schema({ timestamps: true, versionKey: false })
export class BudgetEntry {
  declare _id: Types.ObjectId; // budgetId

  @Prop({ type: String, enum: BudgetCategory, required: true })
  category!: BudgetCategory;

  /** Decimal amount in `currency`, at most two decimal places. */
  @Prop({ required: true, min: 0 })
  amount!: number;

  @Prop({ required: true, uppercase: true })
  currency!: string;

  @Prop({ type: String, trim: true })
  description?: string;

  declare createdAt: Date;
  declare updatedAt: Date;
}
export const BudgetEntrySchema = SchemaFactory.createForClass(BudgetEntry);

@Schema({ timestamps: true, versionKey: false })
export class TransportCost {
  declare _id: Types.ObjectId; // transportCostId

  @Prop({ required: true, trim: true })
  fromCity!: string;

  @Prop({ required: true, trim: true })
  toCity!: string;

  @Prop({ type: String, enum: TransportMode, required: true })
  mode!: TransportMode;

  @Prop({ required: true, min: 0 })
  amount!: number;

  @Prop({ required: true, uppercase: true })
  currency!: string;

  /** Required by create/update services. Optional in storage for pre-fix legacy rows. */
  @Prop({ type: Types.ObjectId })
  dayId?: Types.ObjectId;

  @Prop({ type: String, trim: true })
  notes?: string;

  declare createdAt: Date;
  declare updatedAt: Date;
}
export const TransportCostSchema = SchemaFactory.createForClass(TransportCost);

@Schema({ timestamps: true, versionKey: false })
export class ItineraryDay {
  declare _id: Types.ObjectId; // dayId. Day number and date come from array position.

  @Prop({ required: true, trim: true })
  city!: string;

  /** ISO 3166-1 alpha-2 code from the seeded countries dataset. */
  @Prop({ type: String, uppercase: true })
  countryCode?: string;

  @Prop({ type: String, trim: true })
  notes?: string;

  @Prop({ type: [ActivitySchema], default: [] })
  activities!: Activity[];

  @Prop({ type: [BudgetEntrySchema], default: [] })
  budgets!: BudgetEntry[];

  declare createdAt: Date;
  declare updatedAt: Date;
}
export const ItineraryDaySchema = SchemaFactory.createForClass(ItineraryDay);

/** ITN-21: attribution kept on a clone, even if the original is later deleted. */
@Schema({ _id: false, versionKey: false })
export class ClonedFrom {
  @Prop({ type: Types.ObjectId, required: true })
  itineraryId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  authorName!: string;

  @Prop({ required: true })
  title!: string;

  @Prop({ type: Date, required: true })
  clonedAt!: Date;
}
export const ClonedFromSchema = SchemaFactory.createForClass(ClonedFrom);

export type ItineraryDocument = HydratedDocument<Itinerary>;

@Schema({ timestamps: true, optimisticConcurrency: true, collection: 'itineraries' })
export class Itinerary {
  declare _id: Types.ObjectId; // itineraryId

  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 100 })
  title!: string;

  @Prop({ type: String, trim: true })
  description?: string;

  /** ISO 3166-1 alpha-2 codes. */
  @Prop({ type: [String], required: true })
  countries!: string[];

  /** UTC midnight of the first day. */
  @Prop({ type: Date, required: true })
  startDate!: Date;

  @Prop({ type: String, enum: ItineraryVisibility, default: ItineraryVisibility.PRIVATE, required: true })
  visibility!: ItineraryVisibility;

  /** Default display currency for the budget summary. */
  @Prop({ required: true, uppercase: true })
  currency!: string;

  @Prop({ type: [ItineraryDaySchema], default: [] })
  days!: ItineraryDay[];

  @Prop({ type: [TransportCostSchema], default: [] })
  transportCosts!: TransportCost[];

  @Prop({ type: ClonedFromSchema })
  clonedFrom?: ClonedFrom;

  @Prop({ type: Date, default: null })
  publishedAt!: Date | null;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const ItinerarySchema = SchemaFactory.createForClass(Itinerary);
ItinerarySchema.index({ userId: 1, updatedAt: -1 }, { name: 'itineraries_owner_recent' });
ItinerarySchema.index({ visibility: 1, publishedAt: -1 }, { name: 'itineraries_public_recent' });
ItinerarySchema.index({ 'days.activities._id': 1 }, { name: 'itineraries_activity_id' });
ItinerarySchema.index({ 'days.budgets._id': 1 }, { name: 'itineraries_budget_id' });
ItinerarySchema.index({ 'transportCosts._id': 1 }, { name: 'itineraries_transport_cost_id' });
