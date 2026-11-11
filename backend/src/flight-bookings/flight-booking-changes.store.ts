import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { createHash } from 'node:crypto';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { FlightInventoryPort } from './ports/flight-inventory.port';
import { FlightBooking } from './schemas/flight-booking.schema';
import { FlightBookingChange } from './schemas/flight-booking-change.schema';

export function bookingChangeFingerprint(booking: FlightBooking): string {
  return createHash('sha256').update(JSON.stringify({
    segments: booking.segments.map(s => [s.flightId.toString(), s.cabinId.toString(), s.cabinClass, s.fare, s.departureAirportCode, s.arrivalAirportCode]),
    passengers: booking.passengers.map(p => [p._id.toString(), p.type]),
    totalAmount: booking.totalAmount, baggageFee: booking.baggageFee, seatCount: booking.seatCount,
  })).digest('hex');
}
@Injectable()
export class FlightBookingChangesStore implements OnModuleInit {
  constructor(@InjectModel(FlightBookingChange.name) readonly changes: Model<FlightBookingChange>) {}
  async onModuleInit(): Promise<void> { await this.changes.init(); }

  /** Caller owns the original booking write: serialize cancellation with applying a change. */
  async cancelForBooking(id: Types.ObjectId, session: ClientSession, inventory: FlightInventoryPort): Promise<void> {
    const pending = await this.changes.find({ flightBookingId: id, status: BookingStatus.PENDING }).session(session).exec();
    for (const change of pending) await this.release(change._id, BookingStatus.CANCELLED, session, inventory);
  }
  async release(id: Types.ObjectId, status: BookingStatus.CANCELLED | BookingStatus.EXPIRED, session: ClientSession, inventory: FlightInventoryPort): Promise<boolean> {
    const change = await this.changes.findOneAndUpdate({ _id: id, status: BookingStatus.PENDING },
      { $set: { status } }, { returnDocument: 'after', session }).exec();
    if (!change) return false;
    for (const hold of change.holds) {
      if (!await inventory.releaseHeldSeats(hold.cabinId.toString(), hold.seats, session)) throw new ConflictException('Change inventory could not be released');
    }
    return true;
  }
}
