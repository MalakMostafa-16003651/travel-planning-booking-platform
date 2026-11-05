import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AirlineDocument = HydratedDocument<Airline>;

@Schema({ _id: false })
export class BaggagePolicy {
  @Prop({ type: Number, required: true, min: 1, validate: Number.isSafeInteger })
  pricePerExtraBag!: number;

  @Prop({ type: Number, required: true, min: 0, validate: Number.isSafeInteger })
  maxExtraBagsPerPassenger!: number;
}

@Schema({ _id: false })
export class CancellationTier {
  @Prop({ type: Number, required: true, min: 0, validate: Number.isSafeInteger })
  daysBeforeDeparture!: number;

  @Prop({ type: Number, required: true, min: 0, max: 100 })
  refundPercentage!: number;
}

export const BaggagePolicySchema = SchemaFactory.createForClass(BaggagePolicy);
export const CancellationTierSchema = SchemaFactory.createForClass(CancellationTier);

@Schema({ collection: 'airlines', timestamps: true, versionKey: false })
export class Airline {
  declare _id: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, minlength: 2, maxlength: 120 })
  name!: string;

  @Prop({ type: String, required: true, trim: true, uppercase: true, match: /^[A-Z0-9]{2,8}$/ })
  code!: string;

  @Prop({ type: String, trim: true, default: null, maxlength: 500 })
  logo?: string | null;

  @Prop({ type: Boolean, required: true, default: true })
  isActive!: boolean;

  @Prop({ type: BaggagePolicySchema, required: true, default: () => ({ pricePerExtraBag: 1, maxExtraBagsPerPassenger: 0 }) })
  baggagePolicy!: BaggagePolicy;

  @Prop({ type: [CancellationTierSchema], default: [] })
  cancellationTiers!: CancellationTier[];

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const AirlineSchema = SchemaFactory.createForClass(Airline);
AirlineSchema.index({ code: 1 }, { unique: true, name: 'airlines_code_unique' });
