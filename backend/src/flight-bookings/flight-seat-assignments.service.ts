import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { FlightSeatSelectionDto } from './dto/select-flight-seats.dto';
import { FlightSeatAssignment } from './schemas/flight-seat-assignment.schema';

const activeSeats = () => ({ $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] });

@Injectable()
export class FlightSeatAssignmentsService implements OnModuleInit {
  constructor(@InjectModel(FlightSeatAssignment.name) readonly assignments: Model<FlightSeatAssignment>) {}
  async onModuleInit(): Promise<void> { await this.assignments.init(); }
  async list(flightBookingId: string, session?: ClientSession): Promise<FlightSeatSelectionDto[]> {
    const rows = await this.assignments.find({ flightBookingId: new Types.ObjectId(flightBookingId), ...activeSeats() })
      .session(session ?? null).sort({ flightId: 1, seatNumber: 1 }).lean().exec();
    return rows.map(row => ({ flightId: row.flightId.toString(), passengerId: row.passengerId.toString(), seatNumber: row.seatNumber }));
  }
  async occupied(cabinId: string, session?: ClientSession): Promise<number[]> {
    return (await this.assignments.find({ cabinId: new Types.ObjectId(cabinId), ...activeSeats() })
      .session(session ?? null).sort({ seatNumber: 1 }).select('seatNumber').lean().exec()).map(row => row.seatNumber);
  }
  async highestSeat(cabinId: string, session: ClientSession): Promise<number> {
    return (await this.assignments.findOne({ cabinId: new Types.ObjectId(cabinId), ...activeSeats() })
      .session(session).sort({ seatNumber: -1 }).select('seatNumber').lean().exec())?.seatNumber ?? 0;
  }
  async confirm(flightBookingId: Types.ObjectId, session: ClientSession): Promise<void> {
    await this.assignments.updateMany({ flightBookingId }, { $unset: { expiresAt: 1 } }, { session }).exec();
  }
  async release(flightBookingId: Types.ObjectId, session: ClientSession): Promise<void> {
    await this.assignments.deleteMany({ flightBookingId }, { session }).exec();
  }
}
