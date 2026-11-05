import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Error as MongooseError, QueryFilter, Model, Types } from 'mongoose';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/schemas/user.schema';
import { ExchangeRatesService } from './currency/exchange-rates.service';
import { CreateActivityDto, UpdateActivityDto } from './dto/activity.dto';
import { CreateBudgetEntryDto, UpdateBudgetEntryDto } from './dto/budget-entry.dto';
import { BudgetSummaryDto, CategoryTotalsDto } from './dto/budget-summary.dto';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { CreateItineraryDayDto, ReorderItineraryDaysDto, UpdateItineraryDayDto } from './dto/itinerary-day.dto';
import { ItineraryFlightsQueryDto, ItineraryHotelsQueryDto, PublicItinerarySort, SearchPublicItinerariesQueryDto } from './dto/itinerary-queries.dto';
import { AuthorNames, cityGroupsOf, DELETED_USER_NAME, ItineraryDto, ItineraryPageDto, ItinerarySummaryDto } from './dto/itinerary-response.dto';
import { CreateTransportCostDto, UpdateTransportCostDto } from './dto/transport-cost.dto';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';
import {
  BudgetCategory, DAY_MS, dateOfDay, escapeRegex, formatDateOnly, ITINERARY_PAGE_SIZE, ItineraryVisibility, MAX_ACTIVITIES_PER_DAY,
  MAX_BUDGETS_PER_DAY, MAX_DAYS, MAX_IMAGES_PER_ACTIVITY, MAX_TRANSPORT_COSTS, parseDateOnly, roundMoney,
} from './itinerary.rules';
import { ITINERARY_AUTHORS, ItineraryAuthor, ItineraryAuthorsPort, isVisibleAuthor } from './ports/itinerary-authors.port';
import { ITINERARY_CURRENCIES, ItineraryCurrenciesPort } from './ports/itinerary-currencies.port';
import { FlightSearchPort, HotelSearchPort, ITINERARY_FLIGHT_SEARCH, ITINERARY_HOTEL_SEARCH, ItineraryFlightSearch, ItineraryHotelSearch } from './ports/travel-search.port';
import { ActivityImage } from './schemas/activity-image.schema';
import { Activity, BudgetEntry, Itinerary, ItineraryDay, ItineraryDocument, TransportCost } from './schemas/itinerary.schema';

/** Who is asking. Absent for guests. */
export type Viewer = { userId: string; role: UserRole } | undefined;

export interface UploadedImage {
  buffer: Buffer;
  size: number;
  originalname?: string;
}

export interface SearchResult<C> {
  itineraryId: string;
  criteria: C;
  results: unknown;
}

const NOT_FOUND = 'Itinerary not found';

@Injectable()
export class ItinerariesService {
  constructor(
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    @InjectModel(ActivityImage.name) private readonly images: Model<ActivityImage>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @Inject(ITINERARY_AUTHORS) private readonly authors: ItineraryAuthorsPort,
    @Inject(ITINERARY_CURRENCIES) private readonly currencies: ItineraryCurrenciesPort,
    @Inject(ITINERARY_FLIGHT_SEARCH) private readonly flights: FlightSearchPort,
    @Inject(ITINERARY_HOTEL_SEARCH) private readonly hotels: HotelSearchPort,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  // ---------------------------------------------------------------- itineraries (ITN-01, ITN-03, ITN-20)

  async create(input: CreateItineraryDto, viewer: NonNullable<Viewer>): Promise<ItineraryDto> {
    const currency = input.currency
      ? await this.assertCurrency(input.currency, 'currency')
      : await this.defaultCurrency(viewer.userId);
    const visibility = input.visibility ?? ItineraryVisibility.PRIVATE;
    const itinerary = await this.itineraries.create({
      userId: new Types.ObjectId(viewer.userId),
      title: input.title,
      description: input.description,
      countries: input.countries,
      startDate: parseDateOnly(input.startDate),
      visibility,
      currency,
      publishedAt: visibility === ItineraryVisibility.PUBLIC ? new Date() : null,
    });
    return this.toDto(itinerary);
  }

  async listMine(userId: string, page = 1): Promise<ItineraryPageDto> {
    const filter = { userId: new Types.ObjectId(userId) };
    const [rows, total] = await Promise.all([
      this.itineraries.find(filter, { 'days.activities': 0, 'days.budgets': 0, transportCosts: 0 })
        .sort({ updatedAt: -1, _id: -1 }).skip((page - 1) * ITINERARY_PAGE_SIZE).limit(ITINERARY_PAGE_SIZE).lean().exec(),
      this.itineraries.countDocuments(filter).exec(),
    ]);
    const names = await this.attributionNames(rows);
    return pageOf(rows.map((row) => ItinerarySummaryDto.from(row as unknown as Itinerary, names)), page, total);
  }

  /** ITN-03: the owner sees any of theirs; anyone else only visible public ones. */
  async getReadable(itineraryId: string, viewer: Viewer): Promise<ItineraryDto> {
    return this.toDto(await this.findReadable(itineraryId, viewer));
  }

  /** ITN-21: the public view. The owner's own private itinerary is not served here. */
  async getPublic(itineraryId: string): Promise<ItineraryDto> {
    return this.toDto(await this.findReadable(itineraryId, undefined));
  }

  async update(itineraryId: string, userId: string, input: UpdateItineraryDto): Promise<ItineraryDto> {
    const itinerary = await this.findOwned(itineraryId, userId);
    if (input.title !== undefined) itinerary.title = input.title;
    if (input.description !== undefined) itinerary.description = input.description || undefined;
    if (input.countries !== undefined) itinerary.countries = input.countries;
    if (input.startDate !== undefined) itinerary.startDate = parseDateOnly(input.startDate);
    if (input.currency !== undefined) itinerary.currency = await this.assertCurrency(input.currency, 'currency');
    if (input.visibility !== undefined && input.visibility !== itinerary.visibility) {
      itinerary.visibility = input.visibility;
      itinerary.publishedAt = input.visibility === ItineraryVisibility.PUBLIC ? new Date() : null;
    }
    return this.toDto(await this.persist(itinerary));
  }

  async remove(itineraryId: string, userId: string): Promise<void> {
    const itinerary = await this.findOwned(itineraryId, userId);
    await this.itineraries.deleteOne({ _id: itinerary._id }).exec();
    await this.images.deleteMany({ itineraryId: itinerary._id }).exec();
  }

  // ---------------------------------------------------------------- days (ITN-05, ITN-07, ITN-08)

  async addDay(itineraryId: string, userId: string, input: CreateItineraryDayDto): Promise<ItineraryDto> {
    const itinerary = await this.findOwned(itineraryId, userId);
    if (itinerary.days.length >= MAX_DAYS) throw new ConflictException(`An itinerary can have at most ${MAX_DAYS} days`);
    const position = input.position ?? itinerary.days.length + 1;
    if (position > itinerary.days.length + 1) {
      throw fieldError('position', `Position must be between 1 and ${itinerary.days.length + 1}`);
    }
    itinerary.days.splice(position - 1, 0, {
      city: input.city,
      countryCode: input.countryCode,
      notes: input.notes,
      activities: [],
      budgets: [],
    } as unknown as ItineraryDay);
    return this.toDto(await this.persist(itinerary));
  }

  async updateDay(itineraryId: string, dayId: string, userId: string, input: UpdateItineraryDayDto): Promise<ItineraryDto> {
    const itinerary = await this.findOwned(itineraryId, userId);
    const day = findDay(itinerary, dayId);
    if (input.city !== undefined) day.city = input.city;
    if (input.countryCode !== undefined) day.countryCode = input.countryCode || undefined;
    if (input.notes !== undefined) day.notes = input.notes || undefined;
    return this.toDto(await this.persist(itinerary));
  }

  /** Later days move up one place, so their numbers and dates shift back a day. */
  async deleteDay(itineraryId: string, dayId: string, userId: string): Promise<ItineraryDto> {
    const itinerary = await this.findOwned(itineraryId, userId);
    const day = findDay(itinerary, dayId);
    const imageIds = day.activities.flatMap((activity) => activity.images.map((image) => image._id));
    itinerary.days = itinerary.days.filter((candidate) => !candidate._id.equals(day._id));
    for (const cost of itinerary.transportCosts) {
      if (cost.dayId?.equals(day._id)) cost.dayId = undefined;
    }
    const saved = await this.persist(itinerary);
    if (imageIds.length > 0) await this.images.deleteMany({ _id: { $in: imageIds } }).exec();
    return this.toDto(saved);
  }

  /** ITN-08: `dayIds` must list every day exactly once. */
  async reorderDays(itineraryId: string, userId: string, input: ReorderItineraryDaysDto): Promise<ItineraryDto> {
    const itinerary = await this.findOwned(itineraryId, userId);
    const byId = new Map(itinerary.days.map((day) => [day._id.toString(), day]));
    if (input.dayIds.length !== byId.size || input.dayIds.some((id) => !byId.has(id))) {
      throw fieldError('dayIds', 'dayIds must contain every day of this itinerary exactly once');
    }
    itinerary.days = input.dayIds.map((id) => byId.get(id)!);
    return this.toDto(await this.persist(itinerary));
  }

  // ---------------------------------------------------------------- activities (ITN-10, ITN-12)

  async addActivity(itineraryId: string, dayId: string, userId: string, input: CreateActivityDto): Promise<ItineraryDto> {
    assertTimes(input.startTime, input.endTime);
    const itinerary = await this.findOwned(itineraryId, userId);
    const day = findDay(itinerary, dayId);
    if (day.activities.length >= MAX_ACTIVITIES_PER_DAY) {
      throw new ConflictException(`A day can have at most ${MAX_ACTIVITIES_PER_DAY} activities`);
    }
    day.activities.push({ ...input, images: [] } as unknown as Activity);
    return this.toDto(await this.persist(itinerary));
  }

  async updateActivity(activityId: string, userId: string, input: UpdateActivityDto): Promise<ItineraryDto> {
    const { itinerary, activity } = await this.findOwnedActivity(activityId, userId);
    const next = { startTime: activity.startTime, endTime: activity.endTime, ...definedOnly(input) };
    assertTimes(next.startTime, next.endTime);
    for (const [key, value] of Object.entries(definedOnly(input))) {
      (activity as unknown as Record<string, unknown>)[key] = value === '' ? undefined : value;
    }
    return this.toDto(await this.persist(itinerary));
  }

  async deleteActivity(activityId: string, userId: string): Promise<ItineraryDto> {
    const { itinerary, day, activity } = await this.findOwnedActivity(activityId, userId);
    const imageIds = activity.images.map((image) => image._id);
    day.activities = day.activities.filter((candidate) => !candidate._id.equals(activity._id));
    const saved = await this.persist(itinerary);
    if (imageIds.length > 0) await this.images.deleteMany({ _id: { $in: imageIds } }).exec();
    return this.toDto(saved);
  }

  async addImage(activityId: string, userId: string, file: UploadedImage | undefined): Promise<ItineraryDto> {
    if (!file?.buffer?.length) throw fieldError('image', 'An image file is required');
    const contentType = detectImageType(file.buffer);
    if (!contentType) throw fieldError('image', 'Image must be a JPEG, PNG or WebP file');

    const { itinerary, activity } = await this.findOwnedActivity(activityId, userId);
    if (activity.images.length >= MAX_IMAGES_PER_ACTIVITY) {
      throw new ConflictException(`An activity can have at most ${MAX_IMAGES_PER_ACTIVITY} images`);
    }
    const stored = await this.images.create({
      itineraryId: itinerary._id,
      activityId: activity._id,
      userId: itinerary.userId,
      contentType,
      data: file.buffer,
    });
    activity.images.push({
      _id: stored._id,
      contentType,
      size: file.size,
      originalName: file.originalname?.slice(0, 200),
    } as unknown as Activity['images'][number]);
    try {
      return this.toDto(await this.persist(itinerary));
    } catch (error) {
      await this.images.deleteOne({ _id: stored._id }).exec();
      throw error;
    }
  }

  async deleteImage(activityId: string, imageId: string, userId: string): Promise<ItineraryDto> {
    const { itinerary, activity } = await this.findOwnedActivity(activityId, userId);
    const image = activity.images.find((candidate) => candidate._id.toString() === imageId);
    if (!image) throw new NotFoundException('Image not found');
    activity.images = activity.images.filter((candidate) => candidate !== image);
    const saved = await this.persist(itinerary);
    await this.images.deleteOne({ _id: image._id }).exec();
    return this.toDto(saved);
  }

  async getImage(activityId: string, imageId: string, viewer: Viewer): Promise<{ contentType: string; data: Buffer }> {
    const activityOid = toObjectId(activityId, 'Image not found');
    const imageOid = toObjectId(imageId, 'Image not found');
    const itinerary = await this.itineraries.findOne({ 'days.activities._id': activityOid }).exec();
    if (!itinerary || !(await this.canRead(itinerary, viewer))) throw new NotFoundException('Image not found');
    const image = await this.images.findOne({ _id: imageOid, activityId: activityOid, itineraryId: itinerary._id }).exec();
    if (!image) throw new NotFoundException('Image not found');
    return { contentType: image.contentType, data: image.data };
  }

  // ---------------------------------------------------------------- budgets (ITN-14) and transport (ITN-16)

  async addBudget(itineraryId: string, dayId: string, userId: string, input: CreateBudgetEntryDto): Promise<ItineraryDto> {
    const currency = await this.assertCurrency(input.currency, 'currency');
    const itinerary = await this.findOwned(itineraryId, userId);
    const day = findDay(itinerary, dayId);
    if (day.budgets.length >= MAX_BUDGETS_PER_DAY) {
      throw new ConflictException(`A day can have at most ${MAX_BUDGETS_PER_DAY} budget entries`);
    }
    day.budgets.push({ ...input, currency } as unknown as BudgetEntry);
    return this.toDto(await this.persist(itinerary));
  }

  async updateBudget(budgetId: string, userId: string, input: UpdateBudgetEntryDto): Promise<ItineraryDto> {
    const changes = definedOnly(input);
    if (changes.currency) changes.currency = await this.assertCurrency(changes.currency, 'currency');
    const itinerary = await this.findOwnedBy({ 'days.budgets._id': toObjectId(budgetId, 'Budget entry not found') }, userId, 'Budget entry not found');
    const entry = itinerary.days.flatMap((day) => day.budgets).find((candidate) => candidate._id.toString() === budgetId)!;
    for (const [key, value] of Object.entries(changes)) {
      (entry as unknown as Record<string, unknown>)[key] = value === '' ? undefined : value;
    }
    return this.toDto(await this.persist(itinerary));
  }

  async deleteBudget(budgetId: string, userId: string): Promise<ItineraryDto> {
    const itinerary = await this.findOwnedBy({ 'days.budgets._id': toObjectId(budgetId, 'Budget entry not found') }, userId, 'Budget entry not found');
    for (const day of itinerary.days) day.budgets = day.budgets.filter((entry) => entry._id.toString() !== budgetId);
    return this.toDto(await this.persist(itinerary));
  }

  async addTransportCost(itineraryId: string, userId: string, input: CreateTransportCostDto): Promise<ItineraryDto> {
    const currency = await this.assertCurrency(input.currency, 'currency');
    const itinerary = await this.findOwned(itineraryId, userId);
    if (itinerary.transportCosts.length >= MAX_TRANSPORT_COSTS) {
      throw new ConflictException(`An itinerary can have at most ${MAX_TRANSPORT_COSTS} transport costs`);
    }
    if (input.dayId) findDay(itinerary, input.dayId, 'dayId');
    itinerary.transportCosts.push({
      ...input,
      currency,
      dayId: input.dayId ? new Types.ObjectId(input.dayId) : undefined,
    } as unknown as TransportCost);
    return this.toDto(await this.persist(itinerary));
  }

  async updateTransportCost(transportCostId: string, userId: string, input: UpdateTransportCostDto): Promise<ItineraryDto> {
    const changes: Record<string, unknown> = definedOnly(input);
    if (typeof changes.currency === 'string') changes.currency = await this.assertCurrency(changes.currency, 'currency');
    const itinerary = await this.findOwnedBy(
      { 'transportCosts._id': toObjectId(transportCostId, 'Transport cost not found') }, userId, 'Transport cost not found',
    );
    if (typeof changes.dayId === 'string') changes.dayId = findDay(itinerary, changes.dayId, 'dayId')._id;
    const cost = itinerary.transportCosts.find((candidate) => candidate._id.toString() === transportCostId)!;
    for (const [key, value] of Object.entries(changes)) {
      (cost as unknown as Record<string, unknown>)[key] = value === '' ? undefined : value;
    }
    return this.toDto(await this.persist(itinerary));
  }

  async deleteTransportCost(transportCostId: string, userId: string): Promise<ItineraryDto> {
    const itinerary = await this.findOwnedBy(
      { 'transportCosts._id': toObjectId(transportCostId, 'Transport cost not found') }, userId, 'Transport cost not found',
    );
    itinerary.transportCosts = itinerary.transportCosts.filter((cost) => cost._id.toString() !== transportCostId);
    return this.toDto(await this.persist(itinerary));
  }

  /**
   * ITN-14, ITN-18: totals per category, day, city stop and intercity transport, converted
   * into one display currency. Each amount is converted unrounded; only totals are rounded.
   */
  async budgetSummary(itineraryId: string, viewer: Viewer, requestedCurrency?: string): Promise<BudgetSummaryDto> {
    const itinerary = await this.findReadable(itineraryId, viewer);
    const currency = requestedCurrency ? await this.assertCurrency(requestedCurrency, 'currency') : itinerary.currency;

    const sources = new Set<string>([
      ...itinerary.days.flatMap((day) => day.budgets.map((entry) => entry.currency)),
      ...itinerary.transportCosts.map((cost) => cost.currency),
    ]);
    const table = await this.exchangeRates.conversionTable(currency, sources);
    const convert = (amount: number, from: string) => amount * table.toBase.get(from)!;

    const originals = new Map<string, number>();
    const addOriginal = (code: string, amount: number) => originals.set(code, (originals.get(code) ?? 0) + amount);

    const overall = emptyCategories();
    const byDay = itinerary.days.map((day, index) => {
      const categories = emptyCategories();
      for (const entry of day.budgets) {
        const value = convert(entry.amount, entry.currency);
        categories[entry.category] += value;
        overall[entry.category] += value;
        addOriginal(entry.currency, entry.amount);
      }
      return {
        dayId: day._id.toString(),
        dayNumber: index + 1,
        date: formatDateOnly(dateOfDay(itinerary.startDate, index + 1)),
        city: day.city,
        rawTotal: sumCategories(categories),
        categories: roundCategories(categories),
      };
    });
    const rawDayTotals = new Map(byDay.map((day) => [day.dayId, day.rawTotal]));

    const transportCosts = itinerary.transportCosts.map((cost) => {
      addOriginal(cost.currency, cost.amount);
      return {
        transportCostId: cost._id.toString(),
        fromCity: cost.fromCity,
        toCity: cost.toCity,
        mode: cost.mode,
        amount: cost.amount,
        currency: cost.currency,
        rawConverted: convert(cost.amount, cost.currency),
      };
    });
    const daily = sumCategories(overall);
    const transport = transportCosts.reduce((sum, cost) => sum + cost.rawConverted, 0);

    return {
      itineraryId: itinerary._id.toString(),
      currency,
      totals: {
        categories: roundCategories(overall),
        daily: roundMoney(daily),
        transport: roundMoney(transport),
        grandTotal: roundMoney(daily + transport),
      },
      byDay: byDay.map(({ rawTotal, ...day }) => ({ ...day, total: roundMoney(rawTotal) })),
      byCity: cityGroupsOf(itinerary).map((group) => ({
        city: group.city,
        ...(group.countryCode ? { countryCode: group.countryCode } : {}),
        firstDayNumber: group.firstDayNumber,
        lastDayNumber: group.lastDayNumber,
        total: roundMoney(group.dayIds.reduce((sum, id) => sum + (rawDayTotals.get(id) ?? 0), 0)),
      })),
      transportCosts: transportCosts.map(({ rawConverted, ...cost }) => ({ ...cost, convertedAmount: roundMoney(rawConverted) })),
      originalTotals: [...originals].sort(([a], [b]) => a.localeCompare(b))
        .map(([code, amount]) => ({ currency: code, amount: roundMoney(amount) })),
      rateDate: table.rateDate ? formatDateOnly(table.rateDate) : null,
      ratesStale: table.stale,
    };
  }

  // ---------------------------------------------------------------- public search and clone (ITN-20, ITN-21)

  /**
   * Hidden authors (deactivated or missing, ACC-12) are removed before pagination, so
   * `total` and page sizes count only itineraries the caller can open.
   */
  async searchPublic(query: SearchPublicItinerariesQueryDto): Promise<ItineraryPageDto> {
    if (query.minDays && query.maxDays && query.minDays > query.maxDays) {
      throw fieldError('maxDays', 'maxDays must not be less than minDays');
    }
    const page = query.page ?? 1;
    const filter: QueryFilter<Itinerary> = { visibility: ItineraryVisibility.PUBLIC };
    if (query.q) {
      const pattern = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ title: pattern }, { description: pattern }, { 'days.city': pattern }];
    }
    if (query.country) filter.countries = query.country;
    if (query.city) filter['days.city'] = new RegExp(`^${escapeRegex(query.city)}$`, 'i');
    const sizeConditions: unknown[] = [];
    if (query.minDays) sizeConditions.push({ $gte: [{ $size: '$days' }, query.minDays] });
    if (query.maxDays) sizeConditions.push({ $lte: [{ $size: '$days' }, query.maxDays] });
    if (sizeConditions.length > 0) filter.$expr = { $and: sizeConditions };

    const candidateAuthors = (await this.itineraries.distinct('userId', filter).exec()) as Types.ObjectId[];
    const authors = await this.authors.getAuthors(candidateAuthors.map((id) => id.toString()));
    const visibleAuthors = candidateAuthors.filter((id) => isVisibleAuthor(authors.get(id.toString())));
    const visibleFilter: QueryFilter<Itinerary> = { ...filter, userId: { $in: visibleAuthors } };

    const sort = SORTS[query.sort ?? PublicItinerarySort.NEWEST];
    const projection = { title: 1, description: 1, countries: 1, startDate: 1, visibility: 1, currency: 1, userId: 1,
      clonedFrom: 1, publishedAt: 1, createdAt: 1, updatedAt: 1, 'days._id': 1, 'days.city': 1, 'days.countryCode': 1 };
    const [rows, total] = await Promise.all([
      this.itineraries.aggregate<Itinerary>([
        { $match: visibleFilter },
        { $addFields: { dayCount: { $size: '$days' } } },
        { $sort: sort },
        { $skip: (page - 1) * ITINERARY_PAGE_SIZE },
        { $limit: ITINERARY_PAGE_SIZE },
        { $project: projection },
      ]).exec(),
      this.itineraries.countDocuments(visibleFilter).exec(),
    ]);
    const names = await this.attributionNames(rows, authors);
    return pageOf(rows.map((row) => ItinerarySummaryDto.from(row, names)), page, total);
  }

  /** ITN-21: an independent private copy. Author status is rechecked at clone time. */
  async clone(itineraryId: string, viewer: NonNullable<Viewer>): Promise<ItineraryDto> {
    const source = await this.findReadable(itineraryId, undefined);
    const author = (await this.authors.getAuthors([source.userId.toString()])).get(source.userId.toString());
    if (!isVisibleAuthor(author)) throw new NotFoundException(NOT_FOUND);

    const newCloneId = new Types.ObjectId();
    const dayIdMap = new Map<string, Types.ObjectId>();
    const imageCopies: { from: Types.ObjectId; to: Types.ObjectId; activityId: Types.ObjectId }[] = [];
    const days = source.days.map((day) => {
      const dayId = new Types.ObjectId();
      dayIdMap.set(day._id.toString(), dayId);
      return {
        _id: dayId,
        city: day.city,
        countryCode: day.countryCode,
        notes: day.notes,
        activities: day.activities.map((activity) => {
          const activityId = new Types.ObjectId();
          return {
            _id: activityId,
            title: activity.title,
            description: activity.description,
            location: activity.location,
            attractionId: activity.attractionId,
            startTime: activity.startTime,
            endTime: activity.endTime,
            images: activity.images.map((image) => {
              const imageId = new Types.ObjectId();
              imageCopies.push({ from: image._id, to: imageId, activityId });
              return { _id: imageId, contentType: image.contentType, size: image.size, originalName: image.originalName };
            }),
          };
        }),
        budgets: day.budgets.map((entry) => ({
          category: entry.category, amount: entry.amount, currency: entry.currency, description: entry.description,
        })),
      };
    });

    // Copy image bytes first, so the clone never references an image that does not exist.
    const copied = new Set<string>();
    for (const copy of imageCopies) {
      const original = await this.images.findById(copy.from).exec();
      if (!original) continue;
      copied.add(copy.to.toString());
      await this.images.create({
        _id: copy.to, itineraryId: newCloneId, activityId: copy.activityId, userId: new Types.ObjectId(viewer.userId),
        contentType: original.contentType, data: original.data,
      });
    }
    for (const day of days) {
      for (const activity of day.activities) activity.images = activity.images.filter((image) => copied.has(image._id.toString()));
    }

    try {
      const clone = await this.itineraries.create({
        _id: newCloneId,
        userId: new Types.ObjectId(viewer.userId),
        title: source.title,
        description: source.description,
        countries: source.countries,
        startDate: source.startDate,
        visibility: ItineraryVisibility.PRIVATE,
        currency: source.currency,
        publishedAt: null,
        days,
        transportCosts: source.transportCosts.map((cost) => ({
          fromCity: cost.fromCity, toCity: cost.toCity, mode: cost.mode, amount: cost.amount, currency: cost.currency,
          notes: cost.notes, dayId: cost.dayId ? dayIdMap.get(cost.dayId.toString()) : undefined,
        })),
        clonedFrom: {
          itineraryId: source._id,
          userId: source.userId,
          authorName: author.name,
          title: source.title,
          clonedAt: new Date(),
        },
      });
      return this.toDto(clone);
    } catch (error) {
      await this.images.deleteMany({ itineraryId: newCloneId }).exec();
      throw error;
    }
  }

  // ---------------------------------------------------------------- flight and hotel search reuse (ITN-25, ITN-26)

  /** ITN-25: hotels for the city stop containing `dayId`, from its first day to the morning after its last. */
  async searchHotels(itineraryId: string, viewer: Viewer, query: ItineraryHotelsQueryDto): Promise<SearchResult<ItineraryHotelSearch>> {
    const itinerary = await this.findReadable(itineraryId, viewer);
    findDay(itinerary, query.dayId, 'dayId');
    const group = cityGroupsOf(itinerary).find((candidate) => candidate.dayIds.includes(query.dayId))!;
    const criteria: ItineraryHotelSearch = {
      city: group.city,
      ...(group.countryCode ? { countryCode: group.countryCode } : {}),
      checkIn: group.startDate,
      checkOut: formatDateOnly(new Date(parseDateOnly(group.endDate).getTime() + DAY_MS)),
      guests: query.guests ?? 1,
      ...(query.page ? { page: query.page } : {}),
    };
    return { itineraryId, criteria, results: await this.hotels.search(criteria) };
  }

  /** ITN-26: a flight into the stop that begins on `dayId`, from the previous stop (or originCity). */
  async searchFlights(itineraryId: string, viewer: Viewer, query: ItineraryFlightsQueryDto): Promise<SearchResult<ItineraryFlightSearch>> {
    const itinerary = await this.findReadable(itineraryId, viewer);
    findDay(itinerary, query.dayId, 'dayId');
    const groups = cityGroupsOf(itinerary);
    const index = groups.findIndex((group) => group.dayIds[0] === query.dayId);
    if (index < 0) throw fieldError('dayId', 'Choose the first day of a city stop: flights arrive on the day you change city');
    const destination = groups[index];
    const previous = index > 0 ? groups[index - 1] : undefined;
    const originCity = query.originCity ?? previous?.city;
    if (!originCity) throw fieldError('originCity', 'originCity is required for the first stop of the trip');
    const originCountryCode = query.originCity ? query.originCountryCode : previous?.countryCode;

    const adults = query.adults ?? 1;
    const children = query.children ?? 0;
    const infants = query.infants ?? 0;
    if (adults + children < 1) throw fieldError('adults', 'At least one adult or child is required');
    const criteria: ItineraryFlightSearch = {
      originCity,
      ...(originCountryCode ? { originCountryCode } : {}),
      destinationCity: destination.city,
      ...(destination.countryCode ? { destinationCountryCode: destination.countryCode } : {}),
      departureDate: destination.startDate,
      adults,
      children,
      infants,
      ...(query.cabinClass ? { cabinClass: query.cabinClass } : {}),
      ...(query.page ? { page: query.page } : {}),
    };
    return { itineraryId, criteria, results: await this.flights.search(criteria) };
  }

  // ---------------------------------------------------------------- helpers

  /**
   * ACC-11: the owner can always read; nobody else (admins included) can read a private one.
   * ACC-12: a public itinerary of a deactivated or missing author is hidden. Hidden and
   * forbidden both look like "not found".
   */
  private async findReadable(itineraryId: string, viewer: Viewer): Promise<ItineraryDocument> {
    const itinerary = await this.itineraries.findById(toObjectId(itineraryId, NOT_FOUND)).exec();
    if (!itinerary || !(await this.canRead(itinerary, viewer))) throw new NotFoundException(NOT_FOUND);
    return itinerary;
  }

  private async canRead(itinerary: ItineraryDocument, viewer: Viewer): Promise<boolean> {
    if (viewer && itinerary.userId.toString() === viewer.userId) return true;
    if (itinerary.visibility !== ItineraryVisibility.PUBLIC) return false;
    const authors = await this.authors.getAuthors([itinerary.userId.toString()]);
    return isVisibleAuthor(authors.get(itinerary.userId.toString()));
  }

  private findOwned(itineraryId: string, userId: string): Promise<ItineraryDocument> {
    return this.findOwnedBy({ _id: toObjectId(itineraryId, NOT_FOUND) }, userId, NOT_FOUND);
  }

  private async findOwnedBy(filter: QueryFilter<Itinerary>, userId: string, message: string): Promise<ItineraryDocument> {
    const itinerary = await this.itineraries.findOne({ ...filter, userId: new Types.ObjectId(userId) }).exec();
    if (!itinerary) throw new NotFoundException(message);
    return itinerary;
  }

  private async findOwnedActivity(activityId: string, userId: string) {
    const itinerary = await this.findOwnedBy(
      { 'days.activities._id': toObjectId(activityId, 'Activity not found') }, userId, 'Activity not found',
    );
    for (const day of itinerary.days) {
      const activity = day.activities.find((candidate) => candidate._id.toString() === activityId);
      if (activity) return { itinerary, day, activity };
    }
    throw new NotFoundException('Activity not found');
  }

  /** Saves with optimistic concurrency: a concurrent edit makes this one fail with 409. */
  private async persist(itinerary: ItineraryDocument): Promise<ItineraryDocument> {
    try {
      return await itinerary.save();
    } catch (error) {
      if (error instanceof MongooseError.VersionError || error instanceof MongooseError.DocumentNotFoundError) {
        throw new ConflictException('The itinerary was changed by another request. Reload and try again.');
      }
      throw error;
    }
  }

  private async toDto(itinerary: ItineraryDocument): Promise<ItineraryDto> {
    return ItineraryDto.fromItinerary(itinerary.toObject() as Itinerary, await this.attributionNames([itinerary]));
  }

  /** Names for authors and clone attributions; deactivated or missing authors show as "Deleted user". */
  private async attributionNames(rows: Pick<Itinerary, 'userId' | 'clonedFrom'>[], known = new Map<string, ItineraryAuthor>()): Promise<AuthorNames> {
    const ids = [...new Set(rows.flatMap((row) => [row.userId.toString(), ...(row.clonedFrom ? [row.clonedFrom.userId.toString()] : [])]))];
    const unknown = ids.filter((id) => !known.has(id));
    const authors = unknown.length > 0 ? new Map([...known, ...(await this.authors.getAuthors(unknown))]) : known;
    return new Map(ids.map((id) => {
      const author = authors.get(id);
      return [id, isVisibleAuthor(author) ? author.name : DELETED_USER_NAME];
    }));
  }

  private async assertCurrency(code: string, field: string): Promise<string> {
    const normalized = code.trim().toUpperCase();
    if (!(await this.currencies.isSupported(normalized))) {
      const supported = await this.currencies.listSupported();
      throw fieldError(field, `Unsupported currency ${normalized}. Supported: ${supported.map(({ code }) => code).join(', ')}`);
    }
    return normalized;
  }

  /** The user's preferredCurrency when it is in the catalog, else USD. */
  private async defaultCurrency(userId: string): Promise<string> {
    const user = await this.users.findById(userId, { preferredCurrency: 1 }).lean().exec();
    const preferred = user?.preferredCurrency?.toUpperCase();
    return preferred && (await this.currencies.isSupported(preferred)) ? preferred : 'USD';
  }
}

const SORTS: Record<PublicItinerarySort, Record<string, 1 | -1>> = {
  [PublicItinerarySort.NEWEST]: { publishedAt: -1, _id: -1 },
  [PublicItinerarySort.OLDEST]: { publishedAt: 1, _id: 1 },
  [PublicItinerarySort.TITLE]: { title: 1, _id: 1 },
  [PublicItinerarySort.SHORTEST]: { dayCount: 1, _id: 1 },
  [PublicItinerarySort.LONGEST]: { dayCount: -1, _id: -1 },
};

function pageOf(items: ItinerarySummaryDto[], page: number, total: number): ItineraryPageDto {
  return { items, page, pageSize: ITINERARY_PAGE_SIZE, total, totalPages: Math.ceil(total / ITINERARY_PAGE_SIZE) };
}

function toObjectId(id: string, notFoundMessage: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id) || String(new Types.ObjectId(id)) !== id.toLowerCase()) {
    throw new NotFoundException(notFoundMessage);
  }
  return new Types.ObjectId(id);
}

function findDay(itinerary: ItineraryDocument, dayId: string, field?: string): ItineraryDay {
  const day = itinerary.days.find((candidate) => candidate._id.toString() === dayId);
  if (!day) {
    if (field) throw fieldError(field, 'Day not found in this itinerary');
    throw new NotFoundException('Day not found');
  }
  return day;
}

function fieldError(field: string, message: string): BadRequestException {
  return new BadRequestException({ message: 'Validation failed', errors: { [field]: [message] } });
}

function assertTimes(startTime?: string, endTime?: string): void {
  if (startTime && endTime && endTime < startTime) throw fieldError('endTime', 'End time must not be before start time');
}

function definedOnly<T extends object>(input: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as never;
}

function emptyCategories(): CategoryTotalsDto {
  return { FOOD: 0, ACCOMMODATION: 0, ACTIVITIES: 0, LOCAL_TRANSPORT: 0 };
}

function sumCategories(categories: CategoryTotalsDto): number {
  return Object.values(BudgetCategory).reduce((sum, category) => sum + categories[category], 0);
}

function roundCategories(categories: CategoryTotalsDto): CategoryTotalsDto {
  return {
    FOOD: roundMoney(categories.FOOD),
    ACCOMMODATION: roundMoney(categories.ACCOMMODATION),
    ACTIVITIES: roundMoney(categories.ACTIVITIES),
    LOCAL_TRANSPORT: roundMoney(categories.LOCAL_TRANSPORT),
  };
}

/** GEN-08: trust the file's bytes, not the client-supplied MIME type or extension. */
export function detectImageType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
