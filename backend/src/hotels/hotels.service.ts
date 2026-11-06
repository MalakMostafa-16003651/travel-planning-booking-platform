import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { UserRole } from '../common/enums/user-role.enum';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { BlockRoomDatesDto } from './dto/block-room-dates.dto';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { HotelAvailabilityQueryDto } from './dto/hotel-availability-query.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { UpdateHotelPoliciesDto } from './dto/update-hotel-policies.dto';
import { UpdateRoomAvailabilityDto } from './dto/update-room-availability.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { BlockedRange, BookedRange, RoomAvailability } from './schemas/room-availability.schema';
import { Hotel } from './schemas/hotel.schema';
import { Room } from './schemas/room.schema';

export interface Requester {
  userId: string;
  role: UserRole;
}

export interface RoomAvailabilityOverview {
  roomId: string;
  roomName: string;
  blockedRanges: BlockedRange[];
  bookedRanges: BookedRange[];
}

@Injectable()
export class HotelsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(RoomAvailability.name) private readonly roomAvailabilities: Model<RoomAvailability>,
    @InjectConnection() private readonly connection: Connection,
    private readonly references: ReferenceDataService,
  ) {}

  async create(input: CreateHotelDto): Promise<Hotel> {
    const city = await this.references.resolveCity(input.city, input.countryCode);
    return this.hotels.create({
      name: input.name.trim(),
      city: city.name,
      countryCode: city.countryCode,
      address: input.address.trim(),
      description: input.description ?? null,
      isActive: true,
      checkInTime: '14:00',
      checkOutTime: '11:00',
      cancellationTiers: [],
    });
  }

  /** HTL-02. 404 hides an inactive hotel from everyone except its assigned moderator and admins. */
  async getById(id: string, requester?: Requester): Promise<Hotel> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Hotel not found');
    const hotel = await this.hotels.findById(id).exec();
    if (!hotel) throw new NotFoundException('Hotel not found');
    if (!hotel.isActive && !(await this.canSeeInactive(hotel._id, requester))) {
      throw new NotFoundException('Hotel not found');
    }
    return hotel;
  }

  private async canSeeInactive(hotelId: Types.ObjectId, requester?: Requester): Promise<boolean> {
    if (!requester) return false;
    if (requester.role === UserRole.ADMIN) return true;
    if (requester.role !== UserRole.HOTEL_MODERATOR) return false;
    try {
      const assignedId = await this.getAssignedHotelId(requester.userId);
      return assignedId.equals(hotelId);
    } catch {
      return false;
    }
  }

  /** Contract adapter for Person 2: collection moderatorassignments, fields moderatorId/hotelId. */
  async getAssignedHotelId(moderatorId: string): Promise<Types.ObjectId> {
    if (!Types.ObjectId.isValid(moderatorId)) throw new ForbiddenException('No hotel assignment is configured');
    const assignments = await this.connection.collection('moderatorassignments').find({ moderatorId: new Types.ObjectId(moderatorId) }).limit(2).toArray();
    if (assignments.length !== 1 || !assignments[0].hotelId || !Types.ObjectId.isValid(String(assignments[0].hotelId))) {
      throw new ForbiddenException('Your account must have exactly one valid hotel assignment');
    }
    return new Types.ObjectId(String(assignments[0].hotelId));
  }

  /** :id must be the moderator's own assigned hotel, the same way getOwnedScheduledFlight hides another airline's flight. */
  private async assertOwnHotel(moderatorId: string, hotelId: string): Promise<Types.ObjectId> {
    if (!Types.ObjectId.isValid(hotelId)) throw new NotFoundException('Hotel not found for your assignment');
    const assignedId = await this.getAssignedHotelId(moderatorId);
    if (!assignedId.equals(hotelId)) throw new NotFoundException('Hotel not found for your assignment');
    return assignedId;
  }

  /** HTL-01. The moderator can only ever edit their own assigned hotel, by its own :id. */
  async updateOwn(moderatorId: string, hotelId: string, input: UpdateHotelDto): Promise<Hotel> {
    // Object.keys(input) is unreliable here: with useDefineForClassFields (TS target ES2022+),
    // every declared optional DTO field is already an own `undefined` property on the instance.
    const hasField = [input.name, input.city, input.countryCode, input.address, input.description].some((value) => value !== undefined);
    if (!hasField) throw new BadRequestException('At least one hotel profile field must be supplied');
    const assignedId = await this.assertOwnHotel(moderatorId, hotelId);

    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name.trim();
    if (input.address !== undefined) set.address = input.address.trim();
    if (input.description !== undefined) set.description = input.description.trim();

    if (input.city !== undefined || input.countryCode !== undefined) {
      const current = await this.hotels.findById(assignedId).exec();
      if (!current) throw new NotFoundException('Hotel not found for your assignment');
      // Changing the city re-resolves the country from scratch; changing only the country re-resolves against the existing city.
      const city = await this.references.resolveCity(input.city ?? current.city, input.countryCode ?? (input.city ? undefined : current.countryCode));
      set.city = city.name;
      set.countryCode = city.countryCode;
    }

    const updated = await this.hotels.findByIdAndUpdate(assignedId, { $set: set }, { new: true, runValidators: true }).exec();
    if (!updated) throw new NotFoundException('Hotel not found for your assignment');
    return updated;
  }

  /** HTL-09, HTL-10. */
  async updatePoliciesOwn(moderatorId: string, hotelId: string, input: UpdateHotelPoliciesDto): Promise<Hotel> {
    const hasField = [input.checkInTime, input.checkOutTime, input.cancellationTiers].some((value) => value !== undefined);
    if (!hasField) throw new BadRequestException('Supply checkInTime, checkOutTime, cancellationTiers, or a combination');
    if (input.cancellationTiers) {
      const thresholds = input.cancellationTiers.map((tier) => tier.daysBeforeCheckIn);
      if (new Set(thresholds).size !== thresholds.length) throw new BadRequestException('Cancellation tier thresholds must be unique');
    }
    const assignedId = await this.assertOwnHotel(moderatorId, hotelId);

    const set: Record<string, unknown> = {};
    if (input.checkInTime !== undefined) set.checkInTime = input.checkInTime;
    if (input.checkOutTime !== undefined) set.checkOutTime = input.checkOutTime;
    if (input.cancellationTiers) set.cancellationTiers = [...input.cancellationTiers].sort((a, b) => b.daysBeforeCheckIn - a.daysBeforeCheckIn);

    const updated = await this.hotels.findByIdAndUpdate(assignedId, { $set: set }, { new: true, runValidators: true }).exec();
    if (!updated) throw new NotFoundException('Hotel not found for your assignment');
    return updated;
  }

  /** HTL-03. */
  async createRoom(moderatorId: string, hotelId: string, input: CreateRoomDto): Promise<Room> {
    const assignedId = await this.assertOwnHotel(moderatorId, hotelId);
    return this.rooms.create({
      hotelId: assignedId,
      name: input.name.trim(),
      capacity: input.capacity,
      pricePerNight: input.pricePerNight,
      isActive: true,
    });
  }

  /** Shared by update/deactivate: the room must belong to the caller's own assigned hotel. */
  private async getOwnRoom(moderatorId: string, hotelId: string, roomId: string): Promise<Room> {
    const assignedId = await this.assertOwnHotel(moderatorId, hotelId);
    if (!Types.ObjectId.isValid(roomId)) throw new NotFoundException('Room not found for this hotel');
    const room = await this.rooms.findOne({ _id: roomId, hotelId: assignedId }).exec();
    if (!room) throw new NotFoundException('Room not found for this hotel');
    return room;
  }

  /** HTL-05. */
  async updateRoom(moderatorId: string, hotelId: string, roomId: string, input: UpdateRoomDto): Promise<Room> {
    const hasField = [input.name, input.capacity, input.pricePerNight].some((value) => value !== undefined);
    if (!hasField) throw new BadRequestException('At least one room field must be supplied');
    const room = await this.getOwnRoom(moderatorId, hotelId, roomId);

    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name.trim();
    if (input.capacity !== undefined) set.capacity = input.capacity;
    if (input.pricePerNight !== undefined) set.pricePerNight = input.pricePerNight;

    const updated = await this.rooms.findByIdAndUpdate(room._id, { $set: set }, { new: true, runValidators: true }).exec();
    if (!updated) throw new NotFoundException('Room not found for this hotel');
    return updated;
  }

  /** HTL-06. A soft deactivation, so a room referenced by a past/eventual booking keeps a valid id. */
  async deactivateRoom(moderatorId: string, hotelId: string, roomId: string): Promise<void> {
    const room = await this.getOwnRoom(moderatorId, hotelId, roomId);
    await this.rooms.updateOne({ _id: room._id }, { $set: { isActive: false } }).exec();
  }

  private static overlapFilter(startDate: string, endDate: string): Record<string, unknown> {
    return { startDate: { $lt: endDate }, endDate: { $gt: startDate } };
  }

  /** HTL-04. Blocks a date range for one room, if it does not overlap an existing blocked or booked range. */
  async blockDates(moderatorId: string, hotelId: string, roomId: string, input: BlockRoomDatesDto): Promise<RoomAvailability> {
    const room = await this.getOwnRoom(moderatorId, hotelId, roomId);
    if (input.startDate >= input.endDate) throw new BadRequestException('startDate must be before endDate');

    // Ensure a RoomAvailability document exists for this room first (idempotent), so the conditional
    // push below is a plain non-upsert update: combining upsert with an overlap condition would try to
    // insert a second document (and fail on the unique roomId index) whenever an overlap is found.
    try {
      await this.roomAvailabilities.updateOne(
        { roomId: room._id },
        { $setOnInsert: { roomId: room._id, hotelId: room.hotelId, blockedRanges: [], bookedRanges: [] } },
        { upsert: true },
      ).exec();
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }

    const overlap = HotelsService.overlapFilter(input.startDate, input.endDate);
    const updated = await this.roomAvailabilities.findOneAndUpdate(
      {
        roomId: room._id,
        blockedRanges: { $not: { $elemMatch: overlap } },
        bookedRanges: { $not: { $elemMatch: overlap } },
      },
      { $push: { blockedRanges: { startDate: input.startDate, endDate: input.endDate, reason: input.reason } } },
      { new: true, runValidators: true },
    ).exec();
    if (!updated) throw new ConflictException('These dates overlap an existing blocked or booked range');
    return updated;
  }

  /** HTL-05 (edit a blocked range's dates) and HTL-06 (unblock it). */
  async updateBlockedRange(moderatorId: string, hotelId: string, roomId: string, input: UpdateRoomAvailabilityDto): Promise<RoomAvailability> {
    const room = await this.getOwnRoom(moderatorId, hotelId, roomId);
    const availability = await this.roomAvailabilities.findOne({ roomId: room._id }).exec();
    const target = availability?.blockedRanges.find((range) => range._id.equals(input.blockedRangeId));
    if (!target) throw new NotFoundException('Blocked range not found for this room');

    if (input.remove) {
      if (input.startDate !== undefined || input.endDate !== undefined) {
        throw new BadRequestException('Supply either remove or new dates, not both');
      }
      const updated = await this.roomAvailabilities.findOneAndUpdate(
        { roomId: room._id },
        { $pull: { blockedRanges: { _id: new Types.ObjectId(input.blockedRangeId) } } },
        { new: true },
      ).exec();
      return updated!;
    }

    if (input.startDate === undefined || input.endDate === undefined) {
      throw new BadRequestException('Supply both startDate and endDate to edit a blocked range, or remove: true to unblock it');
    }
    if (input.startDate >= input.endDate) throw new BadRequestException('startDate must be before endDate');

    const overlap = HotelsService.overlapFilter(input.startDate, input.endDate);
    const updated = await this.roomAvailabilities.findOneAndUpdate(
      {
        roomId: room._id,
        blockedRanges: { $not: { $elemMatch: { _id: { $ne: target._id }, ...overlap } } },
        bookedRanges: { $not: { $elemMatch: overlap } },
      },
      { $set: { 'blockedRanges.$[target].startDate': input.startDate, 'blockedRanges.$[target].endDate': input.endDate } },
      { new: true, runValidators: true, arrayFilters: [{ 'target._id': target._id }] },
    ).exec();
    if (!updated) throw new ConflictException('These dates overlap another existing blocked or booked range');
    return updated;
  }

  /** HTL-08. Every active room of the hotel, with its blocked/booked ranges optionally filtered to a window. */
  async getHotelAvailability(moderatorId: string, hotelId: string, query: HotelAvailabilityQueryDto): Promise<RoomAvailabilityOverview[]> {
    if (query.from !== undefined && query.to !== undefined && query.from >= query.to) {
      throw new BadRequestException('from must be before to');
    }
    const assignedId = await this.assertOwnHotel(moderatorId, hotelId);
    const [rooms, availabilities] = await Promise.all([
      this.rooms.find({ hotelId: assignedId, isActive: true }).sort({ name: 1 }).exec(),
      this.roomAvailabilities.find({ hotelId: assignedId }).exec(),
    ]);
    const byRoom = new Map(availabilities.map((availability) => [availability.roomId.toString(), availability]));

    const inWindow = (range: { startDate: string; endDate: string }) =>
      (query.from === undefined || range.endDate > query.from) && (query.to === undefined || range.startDate < query.to);

    return rooms.map((room) => {
      const availability = byRoom.get(room._id.toString());
      return {
        roomId: room._id.toString(),
        roomName: room.name,
        blockedRanges: (availability?.blockedRanges ?? []).filter(inWindow),
        bookedRanges: (availability?.bookedRanges ?? []).filter(inWindow),
      };
    });
  }
}
