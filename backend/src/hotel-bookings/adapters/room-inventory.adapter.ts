import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Hotel, HotelDocument } from '../../hotels/schemas/hotel.schema';
import { BookedRangeStatus, RoomAvailability, RoomAvailabilityDocument } from '../../hotels/schemas/room-availability.schema';
import { Room, RoomDocument } from '../../hotels/schemas/room.schema';

const DUPLICATE_KEY = 11000;

/**
 * Person 6's own adapter over Person 5's hotel collections (contract section 3 and L1/L3/L4).
 * Reads `hotels` and `rooms`; writes ONLY `roomavailabilities.bookedRanges`. Lama's module is not edited.
 */
@Injectable()
export class RoomInventoryAdapter {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    @InjectModel(Room.name) private readonly rooms: Model<RoomDocument>,
    @InjectModel(RoomAvailability.name) private readonly availabilities: Model<RoomAvailabilityDocument>,
  ) {}

  getHotel(hotelId: string, session?: ClientSession): Promise<HotelDocument | null> {
    return this.hotels.findById(hotelId).session(session ?? null).exec();
  }

  getRooms(roomIds: string[], session?: ClientSession): Promise<RoomDocument[]> {
    return this.rooms.find({ _id: { $in: roomIds.map((id) => new Types.ObjectId(id)) } }).session(session ?? null).exec();
  }

  /**
   * L4: a room has no RoomAvailability document until its first blockDates. Create it with the same
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
   * 1. L3: remove this room's expired HELD entries (Person 5's search does not check holdExpiresAt);
   * 2. L1: push a HELD range only if nothing in blockedRanges or bookedRanges overlaps [checkIn, checkOut)
   *    (startDate < checkOut && endDate > checkIn, half-open, the same rule as HotelsService.isRoomFree).
   * Returns false, having added nothing, when the room is not free.
   */
  async holdRoom(
    roomId: Types.ObjectId,
    stay: { checkIn: string; checkOut: string },
    hold: { hotelBookingId: Types.ObjectId; holdExpiresAt: Date; now: Date },
    session: ClientSession,
  ): Promise<boolean> {
    await this.availabilities.updateOne(
      { roomId },
      { $pull: { bookedRanges: { status: BookedRangeStatus.HELD, holdExpiresAt: { $lte: hold.now } } } },
      { session },
    ).exec();
    const overlap = { startDate: { $lt: stay.checkOut }, endDate: { $gt: stay.checkIn } };
    const result = await this.availabilities.updateOne(
      {
        roomId,
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
