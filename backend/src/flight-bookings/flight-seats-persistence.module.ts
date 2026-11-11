import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlightSeatAssignment, FlightSeatAssignmentSchema } from './schemas/flight-seat-assignment.schema';
import { FlightSeatAssignmentsService } from './flight-seat-assignments.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: FlightSeatAssignment.name, schema: FlightSeatAssignmentSchema }])],
  providers: [FlightSeatAssignmentsService], exports: [FlightSeatAssignmentsService],
})
export class FlightSeatsPersistenceModule {}
