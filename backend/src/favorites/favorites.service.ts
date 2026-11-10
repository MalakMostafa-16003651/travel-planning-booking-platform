import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { HotelsService } from '../hotels/hotels.service';
import { ItinerariesService } from '../itineraries/itineraries.service';
import { CreateFavoriteDto } from './dto/create-favorite.dto';
import { FavoriteDto, FavoritePageDto } from './dto/favorite-response.dto';
import { FAVORITES_PAGE_SIZE } from './favorites.constants';
import { Favorite } from './schemas/favorite.schema';

type Target = Pick<Favorite, 'hotelId' | 'itineraryId'>;
type Preview = Pick<FavoriteDto, 'available' | 'hotel' | 'itinerary'>;

function objectId(value: string): Types.ObjectId {
  if (!/^[0-9a-f]{24}$/i.test(value)) throw new BadRequestException('Invalid ID');
  return new Types.ObjectId(value);
}

@Injectable()
export class FavoritesService implements OnModuleInit {
  constructor(
    @InjectModel(Favorite.name) private readonly favorites: Model<Favorite>,
    private readonly hotels: HotelsService,
    private readonly itineraries: ItinerariesService,
  ) {}

  async onModuleInit(): Promise<void> { await this.favorites.init(); }

  async create(userId: string, input: CreateFavoriteDto): Promise<FavoriteDto> {
    if ((input.hotelId !== undefined) === (input.itineraryId !== undefined)) {
      throw new BadRequestException('Exactly one of hotelId or itineraryId is required');
    }
    const target: Target = input.hotelId !== undefined
      ? { hotelId: objectId(input.hotelId) } : { itineraryId: objectId(input.itineraryId!) };
    if (!(await this.preview(target)).available) throw new NotFoundException('Favorite target not found');
    let created: Favorite;
    try {
      created = await this.favorites.create({ userId: objectId(userId), ...target });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw new ConflictException('This item is already in your favorites');
      throw error;
    }
    // Re-read current public visibility; do not return an earlier cached target snapshot.
    return this.present(created);
  }

  async listMine(userId: string, page = 1): Promise<FavoritePageDto> {
    const filter = { userId: objectId(userId) };
    const [rows, total] = await Promise.all([
      this.favorites.find(filter).sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * FAVORITES_PAGE_SIZE).limit(FAVORITES_PAGE_SIZE).lean().exec(),
      this.favorites.countDocuments(filter).exec(),
    ]);
    return {
      items: await Promise.all(rows.map((row) => this.present(row))), page, pageSize: FAVORITES_PAGE_SIZE,
      total, totalPages: Math.ceil(total / FAVORITES_PAGE_SIZE),
    };
  }

  async remove(userId: string, favoriteId: string): Promise<void> {
    const result = await this.favorites.deleteOne({ _id: objectId(favoriteId), userId: objectId(userId) }).exec();
    if (result.deletedCount !== 1) throw new NotFoundException('Favorite not found');
  }

  private async present(favorite: Favorite): Promise<FavoriteDto> {
    return {
      favoriteId: favorite._id.toString(), userId: favorite.userId.toString(),
      ...(favorite.hotelId ? { hotelId: favorite.hotelId.toString() } : {}),
      ...(favorite.itineraryId ? { itineraryId: favorite.itineraryId.toString() } : {}),
      createdAt: favorite.createdAt, updatedAt: favorite.updatedAt,
      ...await this.preview(favorite),
    };
  }

  /** Reuse the owners' public read rules, including deactivated authors and inactive hotels. */
  private async preview(target: Target): Promise<Preview> {
    try {
      if (target.hotelId) {
        const hotel = await this.hotels.getById(target.hotelId.toString());
        return { available: true, hotel: { hotelId: hotel._id.toString(), name: hotel.name, city: hotel.city, countryCode: hotel.countryCode } };
      }
      const itinerary = await this.itineraries.getPublic(target.itineraryId!.toString());
      return {
        available: true,
        itinerary: {
          itineraryId: itinerary.itineraryId, title: itinerary.title, countries: itinerary.countries,
          cities: itinerary.cities, startDate: itinerary.startDate, dayCount: itinerary.dayCount, currency: itinerary.currency,
          ...(itinerary.endDate ? { endDate: itinerary.endDate } : {}),
        },
      };
    } catch (error) {
      if (error instanceof NotFoundException) return { available: false };
      // A database/owner-service failure must not masquerade as an unavailable/deleted target.
      throw error;
    }
  }
}
