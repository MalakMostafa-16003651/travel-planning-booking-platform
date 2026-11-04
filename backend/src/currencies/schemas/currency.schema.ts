import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CurrencyDocument = HydratedDocument<Currency>;

@Schema({ collection: 'currencies', timestamps: true, versionKey: false })
export class Currency {
  declare _id: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, uppercase: true, match: /^[A-Z]{3}$/ })
  code!: string;

  @Prop({ type: String, required: true, trim: true })
  name!: string;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const CurrencySchema = SchemaFactory.createForClass(Currency);
CurrencySchema.index({ code: 1 }, { unique: true, name: 'currencies_code_unique' });
