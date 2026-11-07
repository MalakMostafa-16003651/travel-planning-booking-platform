import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AirportDocument = HydratedDocument<Airport>;

@Schema({ collection: 'airports', timestamps: true, versionKey: false })
export class Airport {
  declare _id: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, uppercase: true, match: /^[A-Z]{3}$/ })
  code!: string;

  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, required: true, trim: true })
  city!: string;

  @Prop({ type: String, required: true, trim: true })
  country!: string;

  @Prop({ type: String, required: true, trim: true })
  timeZone!: string;
}

export const AirportSchema = SchemaFactory.createForClass(Airport);
AirportSchema.index({ code: 1 }, { unique: true, name: 'airports_iata_code_unique' });
