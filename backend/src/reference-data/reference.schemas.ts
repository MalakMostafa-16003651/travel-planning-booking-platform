import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ collection: 'countries', timestamps: true, versionKey: false })
export class Country {
  declare _id: Types.ObjectId;
  @Prop({ required: true, match: /^[A-Z]{2}$/ }) code!: string;
  @Prop({ required: true, trim: true }) name!: string;
  @Prop({ required: true, match: /^[A-Z]{3}$/ }) currency!: string;
  declare createdAt: Date;
  declare updatedAt: Date;
}
export const CountrySchema = SchemaFactory.createForClass(Country);
CountrySchema.index({ code: 1 }, { unique: true, name: 'countries_code_unique' });

@Schema({ collection: 'cities', timestamps: true, versionKey: false })
export class City {
  declare _id: Types.ObjectId;
  @Prop({ required: true }) cityId!: string;
  @Prop({ required: true, trim: true }) name!: string;
  @Prop({ required: true, match: /^[A-Z]{2}$/ }) countryCode!: string;
  declare createdAt: Date;
  declare updatedAt: Date;
}
export const CitySchema = SchemaFactory.createForClass(City);
CitySchema.index({ cityId: 1 }, { unique: true, name: 'cities_reference_id_unique' });

@Schema({ collection: 'attractions', timestamps: true, versionKey: false })
export class Attraction {
  declare _id: Types.ObjectId;
  @Prop({ required: true, maxlength: 64 }) attractionId!: string;
  @Prop({ required: true, trim: true }) name!: string;
  @Prop({ required: true }) cityId!: string;
  declare createdAt: Date;
  declare updatedAt: Date;
}
export const AttractionSchema = SchemaFactory.createForClass(Attraction);
AttractionSchema.index({ attractionId: 1 }, { unique: true, name: 'attractions_reference_id_unique' });
