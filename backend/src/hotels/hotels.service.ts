import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { UserRole } from '../common/enums/user-role.enum';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { Hotel } from './schemas/hotel.schema';

export interface Requester {
  userId: string;
  role: UserRole;
}

@Injectable()
export class HotelsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
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

  /** HTL-01. The moderator can only ever edit their own assigned hotel, by its own :id. */
  async updateOwn(moderatorId: string, hotelId: string, input: UpdateHotelDto): Promise<Hotel> {
    // Object.keys(input) is unreliable here: with useDefineForClassFields (TS target ES2022+),
    // every declared optional DTO field is already an own `undefined` property on the instance.
    const hasField = [input.name, input.city, input.countryCode, input.address, input.description].some((value) => value !== undefined);
    if (!hasField) throw new BadRequestException('At least one hotel profile field must be supplied');
    if (!Types.ObjectId.isValid(hotelId)) throw new NotFoundException('Hotel not found for your assignment');
    const assignedId = await this.getAssignedHotelId(moderatorId);
    if (!assignedId.equals(hotelId)) throw new NotFoundException('Hotel not found for your assignment');

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
}
