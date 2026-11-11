import { ConflictException, NotFoundException } from '@nestjs/common';
import { advanceBookingVersion, incrementableVersion } from '../../common/booking-gate';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Hotel, HotelDocument } from '../../hotels/schemas/hotel.schema';
import { BookedRangeStatus, RoomAvailability, RoomAvailabilityDocument } from '../../hotels/schemas/room-availability.schema';
import { Room, RoomDocument } from '../../hotels/schemas/room.schema';

const DUPLICATE_KEY = 11000;

/**
 * Person 6's own adapter over Person 5's hotel collections (contract section 3 and L1/L3/L4).
 * Reads hotel/room data and uses their approved private bookingVersion gates; inventory remains in roomavailabilities.
 */
@Injectable()
export class RoomInventoryAdapter {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    @InjectModel(Room.name) private readonly rooms: Model<RoomDocument>,
    @InjectModel(RoomAvailability.name) private readonly availabilities: Model<RoomAvailabilityDocument>,
  ) {}

  /** Lock hotel first, then sorted room IDs. Provider/room status writes serialize with these gates. */
  async acquireBookingGate(hotelId: string, roomIds: string[], session: ClientSession, requireActive = true): Promise<void> {
    const active = requireActive ? { isActive: true } : {};
    const hotel = await this.hotels.updateOne({ _id: hotelId, ...active, $expr: incrementableVersion('bookingVersion') },
      advanceBookingVersion(), { session, updatePipeline: true, timestamps: false }).exec();
    if (hotel.modifiedCount !== 1) {
      if (!await this.hotels.exists({ _id: hotelId, ...active }).session(session).exec()) throw new NotFoundException('Hotel not found');
      throw new ConflictException('Hotel booking gate is unavailable');
    }
    for (const roomId of [...new Set(roomIds.map(id => id.toLowerCase()))].sort()) {
      const room = await this.rooms.updateOne({ _id: roomId, hotelId, ...active, $expr: incrementableVersion('bookingVersion') },
        advanceBookingVersion(), { session, updatePipeline: true, timestamps: false }).exec();
      if (room.modifiedCount !== 1) {
        if (!await this.rooms.exists({ _id: roomId, hotelId, ...active }).session(session).exec()) throw new NotFoundException('Room not found in this hotel');
        throw new ConflictException('Room booking gate is unavailable');
      }
    }
  }

  getHotel(hotelId: string, session?: ClientSession): Promise<HotelDocument | null> {
    return this.hotels.findById(hotelId).session(session ?? null).exec();
  }

  getRooms(roomIds: string[], session?: ClientSession): Promise<RoomDocument[]> {
    return this.rooms.find({ _id: { $in: roomIds.map((id) => new Types.ObjectId(id)) } }).session(session ?? null).exec();
  }

  /**
   * A legacy room may have no availability document. Create a CLOSED record with the same
   * idempotent upsert Person 5 uses in HotelsService.blockDates ($setOnInsert; a concurrent insert's
   * duplicate-key error means it now exists). Runs before the hold transaction, so the conditional
   * hold below can stay a plain non-upsert update.
   */
  async ensureAvailability(rooms: Pick<Room, '_id' | 'hotelId'>[]): Promise<void> {
    for (const room of rooms) {
      try {
        await this.availabilities.updateOne(
          { roomId: room._id },
          { $setOnInsert: { roomId: room._id, hotelId: room.hotelId, blockedRanges: [], bookedRanges: [] } },
          { upsert: true },
        ).exec();
      } catch (error) {
        if ((error as { code?: number }).code !== DUPLICATE_KEY) throw error;
      }
    }
  }

  /**
   * HTL-18, inside the caller's transaction:
   * 1. Remove expired HELD entries (public readers also ignore their elapsed deadlines);
   * 2. Push a HELD range only inside configured positive availability, with no blocked/booked overlap [checkIn, checkOut)
   *    (startDate < checkOut && endDate > checkIn, half-open, the same rule as HotelsService.isRoomFree).
   * Returns false, having added nothing, when the room is not free.
   */
  async holdRoom(
    roomId: Types.ObjectId,
    stay: { checkIn: string; checkOut: string },
    hold: { hotelBookingId: Types.ObjectId; holdExpiresAt: Date; now: Date },
    session: ClientSession,
  ): Promise<boolean> {
    await this.releaseExpiredRoomHolds(roomId,hold.now,session);
    const overlap = { startDate: { $lt: stay.checkOut }, endDate: { $gt: stay.checkIn } };
    const result = await this.availabilities.updateOne(
      {
        roomId,
        bookableRanges: { $elemMatch: { startDate: { $lte: stay.checkIn }, endDate: { $gte: stay.checkOut } } },
        blockedRanges: { $not: { $elemMatch: overlap } },
        bookedRanges: { $not: { $elemMatch: overlap } },
      },
      {
        $push: {
          bookedRanges: {
            startDate: stay.checkIn,
            endDate: stay.checkOut,
            status: BookedRangeStatus.HELD,
            holdExpiresAt: hold.holdExpiresAt,
            hotelBookingId: hold.hotelBookingId,
          },
        },
      },
      { session, runValidators: true },
    ).exec();
    return result.modifiedCount === 1;
  }

  /** Shared by new holds and moderator blocking; elapsed holds no longer own these nights. */
  async releaseExpiredRoomHolds(roomId: Types.ObjectId, now: Date, session?: ClientSession): Promise<void> {
    await this.availabilities.updateOne({ roomId },
      { $pull: { bookedRanges: { status: BookedRangeStatus.HELD, holdExpiresAt: { $lte: now } } } }, { session }).exec();
  }

  /** HTL-17: convert exactly this reservation's live hold, inside the booking transaction. */
  async confirmHeldRoom(roomId: Types.ObjectId, hotelBookingId: Types.ObjectId,
    stay: { checkIn: string; checkOut: string }, now: Date, session: ClientSession): Promise<boolean> {
    const held = { hotelBookingId, status: BookedRangeStatus.HELD,
      startDate: stay.checkIn, endDate: stay.checkOut, holdExpiresAt: { $gt: now } };
    const result = await this.availabilities.updateOne({ roomId,
      blockedRanges: { $not: { $elemMatch: { startDate: { $lt: stay.checkOut }, endDate: { $gt: stay.checkIn } } } },
      bookedRanges: { $elemMatch: held },
    }, { $set: { 'bookedRanges.$[held].status': BookedRangeStatus.BOOKED },
      $unset: { 'bookedRanges.$[held].holdExpiresAt': 1 } },
    { session, arrayFilters: [Object.fromEntries(Object.entries(held).map(([key, value]) => ['held.' + key, value]))] }).exec();
    return result.modifiedCount === 1;
  }

  /** HTL-21: release only this cancelled reservation's booked ranges. */
  async releaseBookedRooms(hotelBookingId: Types.ObjectId, roomIds: Types.ObjectId[], session: ClientSession): Promise<void> {
    await this.availabilities.updateMany({ roomId: { $in: roomIds } },
      { $pull: { bookedRanges: { hotelBookingId, status: BookedRangeStatus.BOOKED } } }, { session }).exec();
  }

  /** Expiry: removes this reservation's HELD entries from its rooms (BOOKED ones are never touched). */
  async releaseHolds(hotelBookingId: Types.ObjectId, roomIds: Types.ObjectId[], session: ClientSession): Promise<void> {
    await this.availabilities.updateMany(
      { roomId: { $in: roomIds } },
      { $pull: { bookedRanges: { hotelBookingId, status: BookedRangeStatus.HELD } } },
      { session },
    ).exec();
  }
}
