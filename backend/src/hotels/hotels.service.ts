import { PLATFORM_CURRENCY } from '../flight-bookings/flight-booking.rules';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { RoomInventoryAdapter } from '../hotel-bookings/adapters/room-inventory.adapter';
import { ReviewRatingsService } from '../reviews/review-ratings.service';
import { activeBookedRange, assertDates, BookableDates, coversStay, normalizeBookableRanges } from './hotel-availability.rules';
import { SetRoomBookableRangesDto } from './dto/set-room-bookable-ranges.dto';
import { assertSearchStay } from './hotel-search.rules';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { ReviewsService } from '../reviews/reviews.service';
import { HotelDetailQueryDto } from './dto/hotel-detail-query.dto';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { AuditAction, AuditTargetType } from '../audit-logs/audit-log.enums';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { UserRole } from '../common/enums/user-role.enum';
import { HotelBookingsService } from '../hotel-bookings/hotel-bookings.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { AvailableRoomsQueryDto } from './dto/available-rooms-query.dto';
import { BlockRoomDatesDto } from './dto/block-room-dates.dto';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { HotelAvailabilityQueryDto } from './dto/hotel-availability-query.dto';
import { HotelSearchSort, SearchHotelsQueryDto } from './dto/search-hotels-query.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { UpdateHotelPoliciesDto } from './dto/update-hotel-policies.dto';
import { UpdateRoomAvailabilityDto } from './dto/update-room-availability.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { MAX_HOTEL_PHOTOS, detectPhotoContentType } from './hotels.rules';
import { HOTEL_RESERVATIONS, HotelReservationsPage, HotelReservationsPort } from './ports/hotel-reservations.port';
import { BlockedRange, BookedRange, RoomAvailability } from './schemas/room-availability.schema';
import { Hotel } from './schemas/hotel.schema';
import { HotelPhoto } from './schemas/hotel-photo.schema';
import { Room } from './schemas/room.schema';

export interface Requester {
  userId: string;
  role: UserRole;
}

export interface RoomDayOverview {date:string;status:'AVAILABLE'|'BOOKED'|'BLOCKED';bookingReference?:string;hotelBookingId?:string;bookingStatus?:BookingStatus;reason?:string;}
export interface RoomAvailabilityPage {items:RoomAvailabilityOverview[];page:number;pageSize:number;total:number;totalPages:number;from:string;to:string;}
export interface AvailableRoomsPage {items:(Room & {roomId:string;totalStayPrice:number;currency:string})[];page:number;pageSize:number;total:number;totalPages:number;}
export interface RoomAvailabilityOverview {
  isActive:boolean;
  bookableRanges:BookableDates[];
  days:RoomDayOverview[];
  roomId: string;
  roomName: string;
  blockedRanges: BlockedRange[];
  bookedRanges: BookedRange[];
}

export interface HotelSearchResult {
  hotelId: string;
  name: string;
  city: string;
  countryCode: string;
  checkInTime: string;
  checkOutTime: string;
  /** The cheapest qualifying room's nightly price, integer minor units. */
  fromPrice: number;
  availableRooms: number;
  starClass?: number;
  amenities?: string[];
  averageRating: number | null;
  ratingCount: number;
}

export interface HotelSearchPage {
  items: HotelSearchResult[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** The part of a multer file this service reads (kept in memory, never written to disk). */
export interface UploadedPhoto {
  buffer: Buffer;
  size: number;
}

const HOTEL_SEARCH_PAGE_SIZE = 10; // GEN-05, same as flight bookings and itineraries

@Injectable()
export class HotelsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(RoomAvailability.name) private readonly roomAvailabilities: Model<RoomAvailability>,
    @InjectModel(HotelPhoto.name) private readonly hotelPhotos: Model<HotelPhoto>,
    @InjectConnection() private readonly connection: Connection,
    private readonly references: ReferenceDataService,
    private readonly hotelBookings: HotelBookingsService,
    @Inject(HOTEL_RESERVATIONS) private readonly reservations: HotelReservationsPort,
    private readonly auditLogs: AuditLogsService,
    private readonly ratings: ReviewRatingsService,
    private readonly inventory: RoomInventoryAdapter,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * ReviewsModule imports HotelsModule, so the full ReviewsService cannot be injected here (an import
   * cycle). It is looked up when first needed; in a narrow module without ReviewsModule the result is null.
   */
  private async reviewsService(): Promise<ReviewsService | null> {
    try {
      const { ReviewsService: token } = await import('../reviews/reviews.service');
      return this.moduleRef.get(token, { strict: false });
    } catch {
      return null;
    }
  }

  /**
   * HTL-02: the hotel profile (photos, star class, amenities, check-in/out times, cancellation tiers),
   * its average rating and number of ratings, the newest reviews (first page of 10, same visibility as
   * GET /hotels/:id/reviews) and, when both stay dates are given, the rooms available for that stay
   * (first page, same rules as GET /hotels/:id/rooms/available).
   */
  async getDetails(id: string, requester: Requester | undefined, query: HotelDetailQueryDto): Promise<Record<string, unknown>> {
    if ((query.checkIn === undefined) !== (query.checkOut === undefined)) {
      const field = query.checkIn === undefined ? 'checkIn' : 'checkOut';
      throw new BadRequestException({ message: 'Validation failed', errors: { [field]: ['Give both checkIn and checkOut, or neither'] } });
    }
    const hotel = await this.getById(id, requester) as unknown as Record<string, unknown> & { _id: Types.ObjectId; isActive: boolean };
    const hotelId = hotel._id.toString();
    const reviews = await (await this.reviewsService())?.listForHotel(hotelId, 1, requester) ?? null;
    let availableRooms: AvailableRoomsPage | null = null;
    if (query.checkIn !== undefined && query.checkOut !== undefined) {
      availableRooms = hotel.isActive
        ? await this.getAvailableRooms(hotelId, Object.assign(new AvailableRoomsQueryDto(), { checkIn: query.checkIn, checkOut: query.checkOut, guests: query.guests, page: 1 }))
        // A deactivated hotel (visible only to its moderator/admin) cannot be booked, so nothing is available.
        : { items: [], page: 1, pageSize: 10, total: 0, totalPages: 0 };
    }
    return { ...hotel, hotelId, reviews, availableRooms };
  }

  async create(input: CreateHotelDto, adminId: string): Promise<Hotel> {
    const city = await this.references.resolveCity(input.city, input.countryCode);
    return this.connection.transaction(async (session) => {
      const [hotel] = await this.hotels.create([{
        name: input.name.trim(),
        city: city.name,
        countryCode: city.countryCode,
        address: input.address.trim(),
        description: input.description ?? null,
        starClass: input.starClass,
        amenities: input.amenities.map(v=>v.trim()),
        isActive: true,
        checkInTime: '14:00',
        checkOutTime: '11:00',
        cancellationTiers: [],
        photos: [],
      }], { session });
      await this.auditLogs.log({
        adminId,
        action: AuditAction.HOTEL_CREATED,
        targetType: AuditTargetType.HOTEL,
        targetId: hotel._id.toString(),
      }, session);
      return hotel;
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
    const stats=(await this.ratings.getRatingStats([hotel._id.toString()])).get(hotel._id.toString());
    return {...hotel.toObject(),averageRating:stats?.averageRating??null,ratingCount:stats?.ratingCount??0};
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
    const hasField = [input.name, input.city, input.countryCode, input.address, input.description, input.starClass, input.amenities].some((value) => value !== undefined);
    if (!hasField) throw new BadRequestException('At least one hotel profile field must be supplied');
    const assignedId = await this.assertOwnHotel(moderatorId, hotelId);

    const set: Record<string, unknown> = {};
    if (input.name !== undefined) set.name = input.name.trim();
    if (input.address !== undefined) set.address = input.address.trim();
    if (input.description !== undefined) set.description = input.description.trim();
    if (input.starClass !== undefined) set.starClass = input.starClass;
    if (input.amenities !== undefined) set.amenities = input.amenities.map(v=>v.trim());

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
    try {
      return await this.connection.transaction(async session=>{
        await this.inventory.acquireBookingGate(assignedId.toString(),[],session,false);
        await this.assertRoomNameUnique(assignedId,input.name.trim(),undefined,session);
        const [room]=await this.rooms.create([{hotelId:assignedId,name:input.name.trim(),type:input.type.trim(),beds:input.beds,
          capacity:input.capacity,pricePerNight:input.pricePerNight,isActive:true}],{session});
        return room;
      });
    } catch(error) { if((error as {code?:number}).code===11000)throw new ConflictException('Room name must be unique within this hotel');throw error; }
  }

  private async assertRoomNameUnique(hotelId:Types.ObjectId,name:string,except:Types.ObjectId|undefined,session:import('mongoose').ClientSession):Promise<void> {
    const other=await this.rooms.findOne({hotelId,name,...(except?{_id:{$ne:except}}:{})}).collation({locale:'en',strength:2}).session(session).select('_id').lean().exec();
    if(other)throw new ConflictException('Room name must be unique within this hotel');
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
    const values=[input.name,input.type,input.beds,input.capacity,input.pricePerNight,input.isActive];
    if(!values.some(v=>v!==undefined))throw new BadRequestException('At least one room field must be supplied');
    // HTL-06: deactivation keeps its own reservation check and gate; then the other fields are applied.
    if(input.isActive===false)await this.deactivateRoom(moderatorId,hotelId,roomId);
    const room=await this.getOwnRoom(moderatorId,hotelId,roomId);
    const set:Record<string,unknown>={};
    if(input.name!==undefined)set.name=input.name.trim();
    if(input.type!==undefined)set.type=input.type.trim();
    if(input.beds!==undefined)set.beds=input.beds;
    if(input.capacity!==undefined)set.capacity=input.capacity;
    if(input.pricePerNight!==undefined)set.pricePerNight=input.pricePerNight;
    if(input.isActive===true)set.isActive=true;
    if(!Object.keys(set).length)return room;
    try {
      return await this.connection.transaction(async session=>{
        await this.inventory.acquireBookingGate(room.hotelId.toString(),[room._id.toString()],session,false);
        if(input.name!==undefined||input.type!==undefined||input.beds!==undefined)await this.assertRoomNameUnique(room.hotelId,String(set.name??room.name),room._id,session);
        const updated=await this.rooms.findByIdAndUpdate(room._id,{$set:set},{returnDocument:'after',runValidators:true,session}).exec();
        if(!updated)throw new NotFoundException('Room not found for this hotel');
        return updated;
      });
    } catch(error) { if((error as {code?:number}).code===11000)throw new ConflictException('Room name must be unique within this hotel');throw error; }
  }

  /** Replace positive availability under the same Hotel/Room gates as new reservation holds. */
  async setBookableRanges(moderatorId:string,hotelId:string,roomId:string,input:SetRoomBookableRangesDto):Promise<RoomAvailability> {
    const room=await this.getOwnRoom(moderatorId,hotelId,roomId);
    const ranges=normalizeBookableRanges(input.ranges);
    return this.connection.transaction(async session=>{
      await this.inventory.acquireBookingGate(room.hotelId.toString(),[room._id.toString()],session,false);
      const protectedStays=await this.hotelBookings.protectedRoomStays(room._id.toString(),session);
      if(protectedStays.some(stay=>!coversStay(ranges,stay.startDate,stay.endDate)))throw new ConflictException('Bookable dates cannot be removed for a Confirmed or live Pending reservation');
      return this.roomAvailabilities.findOneAndUpdate({roomId:room._id},
        {$set:{bookableRanges:ranges},$setOnInsert:{roomId:room._id,hotelId:room.hotelId,blockedRanges:[],bookedRanges:[]}},
        {upsert:true,returnDocument:'after',runValidators:true,session}).orFail().exec();
    });
  }

  /**
   * HTL-06. A soft deactivation, so a room referenced by a past/eventual booking keeps a valid id.
   * Refuses with 409 while the room has an active reservation (Osama's roomHasActiveReservations,
   * PR #70): an unexpired PENDING hold, or a CONFIRMED stay that has not checked out yet. The check
   * and the write run in one transaction so a hold cannot slip in between them.
   */
  /**
   * HTL-06 deletion: allowed only for a room that has never been reserved (no reservation of any status
   * references it). Otherwise 409; deactivate it instead (PATCH isActive false), which keeps the ids of its
   * past reservations valid. The room's booking gate is taken first, so a hold racing this delete either
   * commits before it (and the delete sees the reservation) or finds no room and fails.
   */
  async deleteRoom(moderatorId: string, hotelId: string, roomId: string): Promise<void> {
    const room = await this.getOwnRoom(moderatorId, hotelId, roomId);
    await this.connection.transaction(async (session) => {
      await this.inventory.acquireBookingGate(room.hotelId.toString(), [room._id.toString()], session, false);
      const reserved = await this.connection.collection('hotelbookings').findOne({ 'rooms.roomId': room._id }, { session, projection: { _id: 1 } });
      if (reserved) throw new ConflictException('This room has been reserved before and cannot be deleted; deactivate it instead');
      await this.rooms.deleteOne({ _id: room._id }, { session }).exec();
      await this.roomAvailabilities.deleteOne({ roomId: room._id }, { session }).exec();
    });
  }

  async deactivateRoom(moderatorId: string, hotelId: string, roomId: string): Promise<void> {
    const room = await this.getOwnRoom(moderatorId, hotelId, roomId);
    await this.connection.transaction(async (session) => {
      if (await this.hotelBookings.roomHasActiveReservations(room._id.toString(), session)) {
        throw new ConflictException('This room has an active reservation and cannot be deactivated');
      }
      await this.rooms.updateOne({ _id: room._id }, { $set: { isActive: false } }, { session }).exec();
    });
  }

  private static overlapFilter(startDate: string, endDate: string): Record<string, unknown> {
    return { startDate: { $lt: endDate }, endDate: { $gt: startDate } };
  }

  /** HTL-06. Blocks a date range for one room, if it does not overlap an existing blocked or booked range. */
  async blockDates(moderatorId: string, hotelId: string, roomId: string, input: BlockRoomDatesDto): Promise<RoomAvailability> {
    const room = await this.getOwnRoom(moderatorId, hotelId, roomId);
    assertDates(input.startDate,input.endDate);
    await this.inventory.releaseExpiredRoomHolds(room._id,new Date());

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
    assertDates(input.startDate,input.endDate);
    await this.inventory.releaseExpiredRoomHolds(room._id,new Date());

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

  /** Chosen UTC-date window, ten rooms per page; holds expire on read, not only during a sweep. */
  async getHotelAvailability(moderatorId:string,hotelId:string,query:HotelAvailabilityQueryDto):Promise<RoomAvailabilityPage> {
    const assignedId=await this.assertOwnHotel(moderatorId,hotelId);
    const day=(value:string,offset:number)=>new Date(Date.parse(value+'T00:00:00.000Z')+offset*86400000).toISOString().slice(0,10);
    const today=new Date().toISOString().slice(0,10);
    const from=query.from??(query.to?day(query.to,-30):today),to=query.to??day(from,30);
    assertDates(from,to);
    if((Date.parse(to)-Date.parse(from))/86400000>366)throw new BadRequestException('Choose an availability window of at most366 days');
    const page=query.page??1,filter={hotelId:assignedId};
    const [rooms,total]=await Promise.all([this.rooms.find(filter).sort({name:1,_id:1}).skip((page-1)*10).limit(10).exec(),this.rooms.countDocuments(filter).exec()]);
    const availabilities=await this.roomAvailabilities.find({roomId:{$in:rooms.map(r=>r._id)}}).exec();
    const byRoom=new Map(availabilities.map(a=>[a.roomId.toString(),a]));
    const overlaps=(range:{startDate:string;endDate:string})=>range.startDate<to&&range.endDate>from;
    const now=new Date();
    const ids=availabilities.flatMap(a=>a.bookedRanges.filter(r=>overlaps(r)&&activeBookedRange(r,now)).flatMap(r=>r.hotelBookingId?[r.hotelBookingId.toString()]:[])).filter(id=>/^[a-f0-9]{24}$/i.test(id));
    const refs=await this.hotelBookings.availabilityReferences(hotelId,ids);
    const items=rooms.map(room=>{
      const a=byRoom.get(room._id.toString()),blockedRanges=(a?.blockedRanges??[]).filter(overlaps);
      const bookedRanges=(a?.bookedRanges??[]).filter(r=>overlaps(r)&&activeBookedRange(r,now));
      const days:RoomDayOverview[]=[];
      for(let date=from;date<to;date=day(date,1)){
        const next=day(date,1),booked=bookedRanges.find(r=>r.startDate<next&&r.endDate>date);
        const reference=booked?.hotelBookingId?refs.get(booked.hotelBookingId.toString()):undefined;
        if(booked)days.push({date,status:'BOOKED',...(booked.hotelBookingId?{hotelBookingId:booked.hotelBookingId.toString()}:{}),...(reference?{bookingReference:reference.bookingReference,bookingStatus:reference.status}:{})});
        else if(!room.isActive)days.push({date,status:'BLOCKED',reason:'Room is inactive'});
        else if(blockedRanges.some(r=>r.startDate<next&&r.endDate>date))days.push({date,status:'BLOCKED',reason:'Blocked by the hotel moderator'});
        else if(!coversStay(a?.bookableRanges,date,next))days.push({date,status:'BLOCKED',reason:'Outside configured bookable dates'});
        else days.push({date,status:'AVAILABLE'});
      }
      return {roomId:room._id.toString(),roomName:room.name,isActive:room.isActive,bookableRanges:a?.bookableRanges??[],blockedRanges,bookedRanges,days};
    });
    return {items,page,pageSize:10,total,totalPages:Math.ceil(total/10),from,to};
  }

  /** True if nothing in either range list overlaps [checkIn, checkOut). */
  private static isRoomFree(availability: RoomAvailability | undefined, checkIn: string, checkOut: string): boolean {
    const overlaps = (range: { startDate: string; endDate: string }) => range.startDate < checkOut && range.endDate > checkIn;
    return coversStay(availability?.bookableRanges,checkIn,checkOut) && !(availability?.blockedRanges ?? []).some(overlaps) && !(availability?.bookedRanges ?? []).some(r=>overlaps(r)&&activeBookedRange(r));
  }

  /**
   * HTL-11, HTL-12. A hotel qualifies if it has at least `rooms` active rooms free for the whole
   * stay whose combined capacity (best `rooms` by capacity) covers `guests`. Exact room assignment
   * is a booking-time concern (Person 6), not a search-listing one.
   */
  async search(query: SearchHotelsQueryDto): Promise<HotelSearchPage> {
    assertSearchStay(query.checkIn, query.checkOut);
    if (query.minPrice !== undefined && query.maxPrice !== undefined && query.minPrice > query.maxPrice) {
      throw new BadRequestException('minPrice must not be greater than maxPrice');
    }
    let destination: { city?: string; countryCode: string };
    if (query.city) { const city=await this.references.resolveCity(query.city,query.countryCode);destination={city:city.name,countryCode:city.countryCode}; }
    else if(query.countryCode) { await this.references.assertCountries([query.countryCode]);destination={countryCode:query.countryCode}; }
    else throw new BadRequestException('Supply a city or countryCode');
    const roomsNeeded = query.rooms ?? 1;
    const page = query.page ?? 1;

    const hotels = await this.hotels.find({ ...destination, isActive: true }).exec();
    if (hotels.length === 0) return { items: [], page, pageSize: HOTEL_SEARCH_PAGE_SIZE, total: 0, totalPages: 0 };

    const hotelIds = hotels.map((hotel) => hotel._id);
    const ratings=await this.ratings.getRatingStats(hotelIds.map(id=>id.toString()));
    const [allRooms, allAvailabilities] = await Promise.all([
      this.rooms.find({ hotelId: { $in: hotelIds }, isActive: true }).exec(),
      this.roomAvailabilities.find({ hotelId: { $in: hotelIds } }).exec(),
    ]);
    const availabilityByRoom = new Map(allAvailabilities.map((availability) => [availability.roomId.toString(), availability]));
    const roomsByHotel = new Map<string, Room[]>();
    for (const room of allRooms) {
      const key = room.hotelId.toString();
      if (!roomsByHotel.has(key)) roomsByHotel.set(key, []);
      roomsByHotel.get(key)!.push(room);
    }

    const results: HotelSearchResult[] = [];
    for (const hotel of hotels) {
      const rating=ratings.get(hotel._id.toString());
      if(query.minRating!==undefined&&(!rating||rating.averageRating<query.minRating))continue;
      const hotelRooms = roomsByHotel.get(hotel._id.toString()) ?? [];
      const freeRooms = hotelRooms.filter((room) => HotelsService.isRoomFree(availabilityByRoom.get(room._id.toString()), query.checkIn, query.checkOut));
      if (freeRooms.length < roomsNeeded) continue;

      const bestFit = [...freeRooms].sort((a, b) => b.capacity - a.capacity).slice(0, roomsNeeded);
      const totalCapacity = bestFit.reduce((sum, room) => sum + room.capacity, 0);
      if (totalCapacity < query.guests) continue;

      // A displayed room must be able to participate in a selection satisfying the requested guests.
      const byCapacity = [...freeRooms].sort((a, b) => b.capacity - a.capacity);
      const qualifying = freeRooms.filter(room => {
        const others = byCapacity.filter(candidate => !candidate._id.equals(room._id)).slice(0, roomsNeeded - 1);
        return room.capacity + others.reduce((sum, candidate) => sum + candidate.capacity, 0) >= query.guests;
      });
      const fromPrice = Math.min(...qualifying.map(room => room.pricePerNight));
      if (query.minPrice !== undefined && fromPrice < query.minPrice) continue;
      if (query.maxPrice !== undefined && fromPrice > query.maxPrice) continue;

      results.push({
        hotelId: hotel._id.toString(),
        name: hotel.name,
        city: hotel.city,
        countryCode: hotel.countryCode,
        checkInTime: hotel.checkInTime,
        checkOutTime: hotel.checkOutTime,
        fromPrice,
        availableRooms: freeRooms.length,
        starClass:hotel.starClass,amenities:hotel.amenities,averageRating:rating?.averageRating??null,ratingCount:rating?.ratingCount??0,
      });
    }

    if (query.sort === HotelSearchSort.RATING_DESC) results.sort((a,b)=>(b.averageRating??-1)-(a.averageRating??-1)||a.fromPrice-b.fromPrice||a.name.localeCompare(b.name));
    else if (query.sort === HotelSearchSort.PRICE_ASC) results.sort((a, b) => a.fromPrice - b.fromPrice);
    else if (query.sort === HotelSearchSort.PRICE_DESC) results.sort((a, b) => b.fromPrice - a.fromPrice);
    else results.sort((a, b) => a.name.localeCompare(b.name));

    const total = results.length;
    const start = (page - 1) * HOTEL_SEARCH_PAGE_SIZE;
    const items = results.slice(start, start + HOTEL_SEARCH_PAGE_SIZE);
    return { items, page, pageSize: HOTEL_SEARCH_PAGE_SIZE, total, totalPages: Math.ceil(total / HOTEL_SEARCH_PAGE_SIZE) };
  }

  /** HTL-15. Individual rooms (not a hotel-level summary), for picking specific rooms to book. */
  async getAvailableRooms(hotelId:string,query:AvailableRoomsQueryDto):Promise<AvailableRoomsPage> {
    assertSearchStay(query.checkIn,query.checkOut);
    if(!Types.ObjectId.isValid(hotelId))throw new NotFoundException('Hotel not found');
    const hotel=await this.hotels.findOne({_id:hotelId,isActive:true}).exec();
    if(!hotel)throw new NotFoundException('Hotel not found');
    const page=query.page??1,filter:Record<string,unknown>={hotelId:hotel._id,isActive:true};
    if(query.guests!==undefined)filter.capacity={$gte:query.guests};
    const rooms=await this.rooms.find(filter).sort({pricePerNight:1,_id:1}).exec();
    const availabilities=await this.roomAvailabilities.find({roomId:{$in:rooms.map(r=>r._id)}}).exec();
    const byRoom=new Map(availabilities.map(a=>[a.roomId.toString(),a]));
    const free=rooms.filter(r=>HotelsService.isRoomFree(byRoom.get(r._id.toString()),query.checkIn,query.checkOut));
    const nights=(Date.parse(query.checkOut)-Date.parse(query.checkIn))/86400000;
    const items=free.slice((page-1)*10,page*10).map(room=>{
      const totalStayPrice=nights*room.pricePerNight;
      if(!Number.isSafeInteger(totalStayPrice))throw new BadRequestException('Stay price is outside supported minor units');
      return {...(room as import('mongoose').HydratedDocument<Room>).toObject(),roomId:room._id.toString(),totalStayPrice,currency:PLATFORM_CURRENCY};
    });
    return {items,page,pageSize:10,total:free.length,totalPages:Math.ceil(free.length/10)};
  }

  /**
   * ACC-11/HTL-22. Check the authenticated moderator's assignment before the booking query.
   */
  async getReservations(moderatorId: string, hotelId: string, page: number): Promise<HotelReservationsPage> {
    await this.assertOwnHotel(moderatorId, hotelId);
    return this.reservations.listForHotel(hotelId, page);
  }

  /** HTL-01/GEN-08: JPG or PNG by content, at most 5 per hotel. The 5 MB limit is enforced by the upload interceptor. */
  async addPhoto(moderatorId: string, hotelId: string, file: UploadedPhoto | undefined): Promise<Hotel> {
    const assignedId = await this.assertOwnHotel(moderatorId, hotelId);
    if (!file?.buffer?.length) throw new BadRequestException('Send the image in the "photo" form field');
    const contentType = detectPhotoContentType(file.buffer);
    if (!contentType) throw new BadRequestException('Photo must be a JPG or PNG file');

    const stored = await this.hotelPhotos.create({ hotelId: assignedId, data: file.buffer, contentType, size: file.size });
    // The "no 5th photo yet" condition keeps the limit even when uploads race.
    const updated = await this.hotels.findOneAndUpdate(
      { _id: assignedId, [`photos.${MAX_HOTEL_PHOTOS - 1}`]: { $exists: false } },
      { $push: { photos: { _id: stored._id, contentType, size: file.size, uploadedAt: stored.createdAt } } },
      { new: true },
    ).exec();
    if (!updated) {
      await this.hotelPhotos.deleteOne({ _id: stored._id }).exec();
      throw new BadRequestException(`A hotel can have at most ${MAX_HOTEL_PHOTOS} photos`);
    }
    return updated;
  }

  /** HTL-02/GEN-08. Same visibility as the hotel itself: hidden if deactivated, except to its own moderator or an admin. */
  async getPhoto(hotelId: string, photoId: string, requester?: Requester): Promise<HotelPhoto> {
    const hotel = await this.getById(hotelId, requester);
    if (!Types.ObjectId.isValid(photoId)) throw new NotFoundException('Photo not found');
    const photo = await this.hotelPhotos.findOne({ _id: photoId, hotelId: hotel._id }).exec();
    if (!photo) throw new NotFoundException('Photo not found');
    return photo;
  }

  /** HTL-01. */
  async removePhoto(moderatorId: string, hotelId: string, photoId: string): Promise<Hotel> {
    const assignedId = await this.assertOwnHotel(moderatorId, hotelId);
    if (!Types.ObjectId.isValid(photoId)) throw new NotFoundException('Photo not found');
    const updated = await this.hotels.findOneAndUpdate(
      { _id: assignedId, 'photos._id': new Types.ObjectId(photoId) },
      { $pull: { photos: { _id: new Types.ObjectId(photoId) } } },
      { new: true },
    ).exec();
    if (!updated) throw new NotFoundException('Photo not found');
    await this.hotelPhotos.deleteOne({ _id: photoId, hotelId: assignedId }).exec();
    return updated;
  }
}
