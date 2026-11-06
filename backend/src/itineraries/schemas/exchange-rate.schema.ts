import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ExchangeRateDocument = HydratedDocument<ExchangeRate>;

/** ITN-18: cached FXRatesAPI response, one document per base currency. */
@Schema({ timestamps: true, versionKey: false, collection: 'exchangerates' })
export class ExchangeRate {
  declare _id: Types.ObjectId;

  @Prop({ required: true, uppercase: true })
  baseCurrency!: string;

  /** Units of each currency per one unit of baseCurrency. */
  @Prop({ type: Map, of: Number, required: true })
  rates!: Map<string, number>;

  /** Date the provider reports for the rates. */
  @Prop({ type: Date, required: true })
  rateDate!: Date;

  @Prop({ type: Date, required: true })
  fetchedAt!: Date;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const ExchangeRateSchema = SchemaFactory.createForClass(ExchangeRate);
ExchangeRateSchema.index({ baseCurrency: 1 }, { unique: true, name: 'exchangerates_base_unique' });
