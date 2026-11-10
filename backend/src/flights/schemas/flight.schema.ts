import { hideBookingVersion } from '../../common/booking-gate';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FlightStatus } from '../../common/enums/flight-status.enum';

export type FlightDocument = HydratedDocument<Flight>;

@Schema({ collection: 'flights', timestamps: true, versionKey: false })
export class Flight {
  declare _id: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Airline', required: true, index: true }) airlineId!: Types.ObjectId;
  @Prop({ type: String, required: true, trim: true, uppercase: true, match: /^[A-Z0-9]{2,10}$/ }) flightNumber!: string;
  @Prop({ type: String, enum: FlightStatus, default: FlightStatus.SCHEDULED, required: true, index: true }) status!: FlightStatus;
  @Prop({ type: Date, required: true }) departureAt!: Date;
  @Prop({ type: Date, required: true }) arrivalAt!: Date;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Airport', required: true }) departureAirportId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Airport', required: true }) arrivalAirportId!: Types.ObjectId;
  @Prop({ type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }) departureLocalDate!: string;
  /** Private concurrency gate shared with booking transactions. Never part of an API DTO. */
  @Prop({ type: Number, default: 0, select: false, min: 0, max: Number.MAX_SAFE_INTEGER, validate: Number.isSafeInteger })
  bookingVersion!: number;

  declare createdAt: Date;
  declare updatedAt: Date;
}

export const FlightSchema = SchemaFactory.createForClass(Flight);
FlightSchema.set('toJSON', { transform: hideBookingVersion });
FlightSchema.set('toObject', { transform: hideBookingVersion });
FlightSchema.index({ airlineId: 1, flightNumber: 1, departureLocalDate: 1 }, { unique: true, name: 'flight_airline_number_local_date_unique' });
FlightSchema.index({ departureAirportId: 1, arrivalAirportId: 1, departureAt: 1, status: 1 });
