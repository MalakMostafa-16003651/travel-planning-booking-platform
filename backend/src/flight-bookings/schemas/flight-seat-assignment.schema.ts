import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

@Schema({ collection: 'flightseatassignments', timestamps: true, versionKey: false })
export class FlightSeatAssignment {
  declare _id: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) userId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) flightBookingId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) flightId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) cabinId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) passengerId!: Types.ObjectId;
  @Prop({ required: true, min: 1, validate: Number.isSafeInteger }) seatNumber!: number;
  @Prop({ type: Date }) expiresAt?: Date;
  declare createdAt: Date;
  declare updatedAt: Date;
}
export const FlightSeatAssignmentSchema = SchemaFactory.createForClass(FlightSeatAssignment);
FlightSeatAssignmentSchema.index({ flightId: 1, cabinId: 1, seatNumber: 1 }, { unique: true, name: 'flight_seat_unique' });
FlightSeatAssignmentSchema.index({ flightBookingId: 1, flightId: 1, passengerId: 1 }, { unique: true, name: 'booking_passenger_seat_unique' });
FlightSeatAssignmentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'pending_seat_expiry' });

FlightSeatAssignmentSchema.index({ cabinId: 1, seatNumber: 1 }, { name: 'cabin_seat_map' });
