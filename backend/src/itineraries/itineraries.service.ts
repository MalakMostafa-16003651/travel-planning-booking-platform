import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Error as MongooseError, QueryFilter, Model, Types } from 'mongoose';
import { UserRole } from '../common/enums/user-role.enum';
import { User } from '../users/schemas/user.schema';
import { AirportsService } from '../airports/airports.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { ExchangeRatesService } from './currency/exchange-rates.service';
import { CreateActivityDto, UpdateActivityDto } from './dto/activity.dto';
import { CreateBudgetEntryDto, UpdateBudgetEntryDto } from './dto/budget-entry.dto';
import { BudgetSummaryDto, CategoryTotalsDto } from './dto/budget-summary.dto';
import { CreateItineraryDto } from './dto/create-itinerary.dto';
import { ConvertedLinkedBookingDto, CreateLinkedBookingDto, LinkedBookingDto } from './dto/linked-booking.dto';
import { CreateItineraryDayDto, ReorderItineraryDaysDto, UpdateItineraryDayDto } from './dto/itinerary-day.dto';
import { ItineraryFlightsQueryDto, ItineraryHotelsQueryDto, PublicItinerarySort, SearchPublicItinerariesQueryDto } from './dto/itinerary-queries.dto';
import { AuthorNames, cityGroupsOf, DELETED_USER_NAME, ItineraryDto, ItineraryPageDto, ItinerarySummaryDto } from './dto/itinerary-response.dto';
import { CreateTransportCostDto, UpdateTransportCostDto } from './dto/transport-cost.dto';
import { UpdateItineraryDto } from './dto/update-itinerary.dto';
import {
  BudgetCategory, DAY_MS, dateOfDay, escapeRegex, formatDateOnly, ITINERARY_PAGE_SIZE, ItineraryVisibility, LinkedBookingType, MAX_ACTIVITIES_PER_DAY,
  MAX_BUDGETS_PER_DAY, MAX_DAYS, MAX_IMAGES_PER_ACTIVITY, MAX_LINKED_BOOKINGS, MAX_TRANSPORT_COSTS, minorToMajor, parseDateOnly, roundMoney,
} from './itinerary.rules';
import { AccountStatus } from '../common/enums/account-status.enum';
import { detectImageExtension } from '../common/files/image-type';
import {
  ITINERARY_ACCOUNT_STATUSES, ITINERARY_AUTHOR_NAMES, ItineraryAccountStatusesPort, ItineraryAuthorNamesPort, isVisibleStatus,
} from './ports/itinerary-authors.port';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { ITINERARY_FLIGHT_BOOKINGS, ITINERARY_HOTEL_BOOKINGS, ItineraryBookingsPort, LinkableBooking } from './ports/itinerary-bookings.port';
import { ITINERARY_CURRENCIES, ItineraryCurrenciesPort } from './ports/itinerary-currencies.port';
import { FlightSearchPort, HotelSearchPort, ITINERARY_FLIGHT_SEARCH, ITINERARY_HOTEL_SEARCH, ItineraryFlightSearch, ItineraryHotelSearch } from './ports/travel-search.port';
import { ActivityImage } from './schemas/activity-image.schema';
import { Activity, BudgetEntry, Itinerary, ItineraryDay, ItineraryDocument, LinkedBooking, TransportCost } from './schemas/itinerary.schema';

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
const LINK_NOT_FOUND = 'Linked booking not found';

/** ITN-27: a stored link with its live booking (null if the booking no longer exists). */
interface ResolvedLink {
  link: LinkedBooking;
  booking: LinkableBooking | null;
}

@Injectable()
export class ItinerariesService {
  constructor(
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    @InjectModel(ActivityImage.name) private readonly images: Model<ActivityImage>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @Inject(ITINERARY_ACCOUNT_STATUSES) private readonly accountStatuses: ItineraryAccountStatusesPort,
    @Inject(ITINERARY_AUTHOR_NAMES) private readonly authorNames: ItineraryAuthorNamesPort,
    @Inject(ITINERARY_CURRENCIES) private readonly currencies: ItineraryCurrenciesPort,
    @Inject(ITINERARY_FLIGHT_SEARCH) private readonly flights: FlightSearchPort,
    @Inject(ITINERARY_HOTEL_SEARCH) private readonly hotels: HotelSearchPort,
    @Inject(ITINERARY_FLIGHT_BOOKINGS) private readonly flightBookings: ItineraryBookingsPort,
    @Inject(ITINERARY_HOTEL_BOOKINGS) private readonly hotelBookings: ItineraryBookingsPort,
    private readonly exchangeRates: ExchangeRatesService,
    private readonly references: ReferenceDataService,
    private readonly airports: AirportsService,
  ) {}

  // ---------------------------------------------------------------- itineraries (ITN-01, ITN-03, ITN-20)

  async create(input: CreateItineraryDto, viewer: NonNullable<Viewer>): Promise<ItineraryDto> {
    await this.references.assertCountries(input.countries);
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
    return this.toDto(itinerary, viewer.userId);
  }

  async listMine(userId: string, page = 1): Promise<ItineraryPageDto> {
    const filter = { userId: new Types.ObjectId(userId) };
    const [rows, total] = await Promise.all([
      this.itineraries.find(filter, { 'days.activities': 0, 'days.budgets': 0, transportCosts: 0 })
        .sort({ updatedAt: -1, _id: -1 }).skip((page - 1) * ITINERARY_PAGE_SIZE).limit(ITINERARY_PAGE_SIZE).lean().exec(),
      this.itineraries.countDocuments(filter).exec(),
    ]);
    const names = await this.attributionNames(rows, new Map(), userId);
    return pageOf(rows.map((row) => ItinerarySummaryDto.from(row as unknown as Itinerary, names)), page, total);
  }

  /** ITN-03: the owner sees any of theirs; anyone else only visible public ones. */
  async getReadable(itineraryId: string, viewer: Viewer): Promise<ItineraryDto> {
    return this.toDto(await this.findReadable(itineraryId, viewer), viewer?.userId);
  }

  /** ITN-21: the public view. The owner's own private itinerary is not served here. */
  async getPublic(itineraryId: string): Promise<ItineraryDto> {
    return this.toDto(await this.findReadable(itineraryId, undefined));
  }

  async update(itineraryId: string, userId: string, input: UpdateItineraryDto): Promise<ItineraryDto> {
    const itinerary = await this.findOwned(itineraryId, userId);
    if (input.title !== undefined) itinerary.title = input.title;
    if (input.description !== undefined) itinerary.description = input.description || undefined;
    if (input.countries !== undefined) {
      await this.references.assertCountries(input.countries);
      if (itinerary.days.some((day) => day.countryCode && !input.countries!.includes(day.countryCode))) {
        throw fieldError('countries', 'Selected countries must include all existing itinerary days');
      }
      itinerary.countries = input.countries;
    }
    if (input.startDate !== undefined) itinerary.startDate = parseDateOnly(input.startDate);
    if (input.currency !== undefined) itinerary.currency = await this.assertCurrency(input.currency, 'currency');
    if (input.visibility !== undefined && input.visibility !== itinerary.visibility) {
      itinerary.visibility = input.visibility;
      itinerary.publishedAt = input.visibility === ItineraryVisibility.PUBLIC ? new Date() : null;
    }
    return this.toDto(await this.persist(itinerary), userId);
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
    const city = await this.references.resolveCity(input.city, input.countryCode);
    if (!itinerary.countries.includes(city.countryCode)) throw fieldError('city', 'The city must be in a selected itinerary country');
    const position = input.position ?? itinerary.days.length + 1;
    if (position > itinerary.days.length + 1) {
      throw fieldError('position', `Position must be between 1 and ${itinerary.days.length + 1}`);
    }
    itinerary.days.splice(position - 1, 0, {
      city: city.name,
      countryCode: city.countryCode,
      notes: input.notes,
      activities: [],
      budgets: [],
    } as unknown as ItineraryDay);
    return this.toDto(await this.persist(itinerary), userId);
  }

  async updateDay(itineraryId: string, dayId: string, userId: string, input: UpdateItineraryDayDto): Promise<ItineraryDto> {
    const itinerary = await this.findOwned(itineraryId, userId);
    const day = findDay(itinerary, dayId);
    if (input.city !== undefined || input.countryCode !== undefined) {
      const city = await this.references.resolveCity(input.city ?? day.city, input.countryCode ?? (input.city ? undefined : day.countryCode));
      if (!itinerary.countries.includes(city.countryCode)) throw fieldError('city', 'The city must be in a selected itinerary country');
      if (city.name !== day.city || city.countryCode !== day.countryCode) await this.assertDayAttractionsIn(day, city.cityId);
      day.city = city.name;
      day.countryCode = city.countryCode;
    }
    if (input.notes !== undefined) day.notes = input.notes || undefined;
    return this.toDto(await this.persist(itinerary), userId);
  }

  /** Later days move up one place, so their numbers and dates shift back a day. */
  async deleteDay(itineraryId: string, dayId: string, userId: string): Promise<ItineraryDto> {
    const itinerary = await this.findOwned(itineraryId, userId);
    const day = findDay(itinerary, dayId);
    const imageIds = day.activities.flatMap((activity) => activity.images.map((image) => image._id));
    itinerary.days = itinerary.days.filter((candidate) => !candidate._id.equals(day._id));
    itinerary.transportCosts = itinerary.transportCosts.filter((cost) => !cost.dayId?.equals(day._id));
    itinerary.linkedBookings = itinerary.linkedBookings.filter((link) => !link.dayId.equals(day._id));
    const saved = await this.persist(itinerary);
    if (imageIds.length > 0) await this.images.deleteMany({ _id: { $in: imageIds } }).exec();
    return this.toDto(saved, userId);
  }

  /** ITN-08: `dayIds` must list every day exactly once. */
  async reorderDays(itineraryId: string, userId: string, input: ReorderItineraryDaysDto): Promise<ItineraryDto> {
    const itinerary = await this.findOwned(itineraryId, userId);
    const byId = new Map(itinerary.days.map((day) => [day._id.toString(), day]));
    if (input.dayIds.length !== byId.size || input.dayIds.some((id) => !byId.has(id))) {
      throw fieldError('dayIds', 'dayIds must contain every day of this itinerary exactly once');
    }
    itinerary.days = input.dayIds.map((id) => byId.get(id)!);
    return this.toDto(await this.persist(itinerary), userId);
  }

  // ---------------------------------------------------------------- activities (ITN-10, ITN-12)

  async addActivity(itineraryId: string, dayId: string, userId: string, input: CreateActivityDto): Promise<ItineraryDto> {
    assertTimes(input.startTime, input.endTime);
    const itinerary = await this.findOwned(itineraryId, userId);
    const day = findDay(itinerary, dayId);
    if (input.attractionId) await this.assertAttraction(input.attractionId, day);
    const cost = await this.activityCost(input, itinerary.currency);
    if (day.activities.length >= MAX_ACTIVITIES_PER_DAY) {
      throw new ConflictException(`A day can have at most ${MAX_ACTIVITIES_PER_DAY} activities`);
    }
    day.activities.push({ ...input, ...cost, images: [] } as unknown as Activity);
    return this.toDto(await this.persist(itinerary), userId);
  }

  async updateActivity(activityId: string, userId: string, input: UpdateActivityDto): Promise<ItineraryDto> {
    const { itinerary, day, activity } = await this.findOwnedActivity(activityId, userId);
    if (input.attractionId) await this.assertAttraction(input.attractionId, day);
    const cost = await this.activityCost({ cost: input.cost ?? activity.cost, currency: input.currency ?? activity.currency }, itinerary.currency);
    const next = { startTime: activity.startTime, endTime: activity.endTime, ...definedOnly(input) };
    assertTimes(next.startTime, next.endTime);
    for (const [key, value] of Object.entries(definedOnly(input))) {
      (activity as unknown as Record<string, unknown>)[key] = value === '' ? undefined : value;
    }
    activity.cost = cost.cost;
    activity.currency = cost.currency;
    return this.toDto(await this.persist(itinerary), userId);
  }

  async deleteActivity(activityId: string, userId: string): Promise<ItineraryDto> {
    const { itinerary, day, activity } = await this.findOwnedActivity(activityId, userId);
    const imageIds = activity.images.map((image) => image._id);
    day.activities = day.activities.filter((candidate) => !candidate._id.equals(activity._id));
    const saved = await this.persist(itinerary);
    if (imageIds.length > 0) await this.images.deleteMany({ _id: { $in: imageIds } }).exec();
    return this.toDto(saved, userId);
  }

  async addImage(activityId: string, userId: string, file: UploadedImage | undefined): Promise<ItineraryDto> {
    if (!file?.buffer?.length) throw fieldError('image', 'An image file is required');
    const contentType = detectImageType(file.buffer);
    if (!contentType) throw fieldError('image', 'Image must be a JPEG or PNG file');

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
      return this.toDto(await this.persist(itinerary), userId);
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
    return this.toDto(saved, userId);
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
    return this.toDto(await this.persist(itinerary), userId);
  }

  async updateBudget(budgetId: string, userId: string, input: UpdateBudgetEntryDto): Promise<ItineraryDto> {
    const changes = definedOnly(input);
    if (changes.currency) changes.currency = await this.assertCurrency(changes.currency, 'currency');
    const itinerary = await this.findOwnedBy({ 'days.budgets._id': toObjectId(budgetId, 'Budget entry not found') }, userId, 'Budget entry not found');
    const entry = itinerary.days.flatMap((day) => day.budgets).find((candidate) => candidate._id.toString() === budgetId)!;
    for (const [key, value] of Object.entries(changes)) {
      (entry as unknown as Record<string, unknown>)[key] = value === '' ? undefined : value;
    }
    return this.toDto(await this.persist(itinerary), userId);
  }

  async deleteBudget(budgetId: string, userId: string): Promise<ItineraryDto> {
    const itinerary = await this.findOwnedBy({ 'days.budgets._id': toObjectId(budgetId, 'Budget entry not found') }, userId, 'Budget entry not found');
    for (const day of itinerary.days) day.budgets = day.budgets.filter((entry) => entry._id.toString() !== budgetId);
    return this.toDto(await this.persist(itinerary), userId);
  }

  async addTransportCost(itineraryId: string, userId: string, input: CreateTransportCostDto): Promise<ItineraryDto> {
    const currency = await this.assertCurrency(input.currency, 'currency');
    const itinerary = await this.findOwned(itineraryId, userId);
    if (itinerary.transportCosts.length >= MAX_TRANSPORT_COSTS) {
      throw new ConflictException(`An itinerary can have at most ${MAX_TRANSPORT_COSTS} transport costs`);
    }
    findDay(itinerary, input.dayId, 'dayId');
    itinerary.transportCosts.push({
      ...input,
      currency,
      dayId: new Types.ObjectId(input.dayId),
    } as unknown as TransportCost);
    return this.toDto(await this.persist(itinerary), userId);
  }

  async updateTransportCost(transportCostId: string, userId: string, input: UpdateTransportCostDto): Promise<ItineraryDto> {
    const changes: Record<string, unknown> = definedOnly(input);
    if (typeof changes.currency === 'string') changes.currency = await this.assertCurrency(changes.currency, 'currency');
    const itinerary = await this.findOwnedBy(
      { 'transportCosts._id': toObjectId(transportCostId, 'Transport cost not found') }, userId, 'Transport cost not found',
    );
    if (typeof changes.dayId === 'string') changes.dayId = findDay(itinerary, changes.dayId, 'dayId')._id;
    const cost = itinerary.transportCosts.find((candidate) => candidate._id.toString() === transportCostId)!;
    if (!cost.dayId && changes.dayId === undefined) throw fieldError('dayId', 'Assign this legacy transport entry to an itinerary day before updating it');
    for (const [key, value] of Object.entries(changes)) {
      (cost as unknown as Record<string, unknown>)[key] = value === '' ? undefined : value;
    }
    return this.toDto(await this.persist(itinerary), userId);
  }

  async deleteTransportCost(transportCostId: string, userId: string): Promise<ItineraryDto> {
    const itinerary = await this.findOwnedBy(
      { 'transportCosts._id': toObjectId(transportCostId, 'Transport cost not found') }, userId, 'Transport cost not found',
    );
    itinerary.transportCosts = itinerary.transportCosts.filter((cost) => cost._id.toString() !== transportCostId);
    return this.toDto(await this.persist(itinerary), userId);
  }

  /**
   * ITN-14, ITN-18: totals per category, day, city stop and intercity transport, converted
   * into one display currency. Each amount is converted unrounded; only totals are rounded.
   */
  async budgetSummary(itineraryId: string, viewer: Viewer, requestedCurrency?: string): Promise<BudgetSummaryDto> {
    const itinerary = await this.findReadable(itineraryId, viewer);
    const currency = requestedCurrency ? await this.assertCurrency(requestedCurrency, 'currency')
      : viewer ? await this.defaultCurrency(viewer.userId, itinerary.currency) : itinerary.currency;
    // ITN-27: linked bookings are private; only the owner's summary includes them.
    const isOwner = viewer !== undefined && itinerary.userId.toString() === viewer.userId;
    const links = isOwner ? await this.resolveLinks(itinerary) : [];
    const counted = links.filter(({ booking }) => booking !== null && countsInBudget(booking.status));

    const sources = new Set<string>([
      ...counted.map(({ booking }) => booking!.currency),
      ...itinerary.days.flatMap((day) => day.budgets.map((entry) => entry.currency)),
      ...itinerary.days.flatMap((day) => day.activities.filter((activity) => activity.cost !== undefined)
        .map((activity) => activity.currency ?? itinerary.currency)),
      ...itinerary.transportCosts.map((cost) => cost.currency),
    ]);
    const table = await this.exchangeRates.conversionTable(currency, sources);
    const convert = (amount: number, from: string) => amount * table.toBase.get(from)!;

    const originals = new Map<string, number>();
    const addOriginal = (code: string, amount: number) => originals.set(code, (originals.get(code) ?? 0) + amount);

    const overall = emptyCategories();
    let bookedTransport = 0;
    const byDay = itinerary.days.map((day, index) => {
      const categories = emptyCategories();
      let dayBookedTransport = 0;
      for (const { link, booking } of counted) {
        if (!link.dayId.equals(day._id)) continue;
        const major = minorToMajor(booking!.amountMinor, booking!.currency);
        const value = convert(major, booking!.currency);
        addOriginal(booking!.currency, major);
        if (link.type === LinkedBookingType.HOTEL) {
          categories.ACCOMMODATION += value;
          overall.ACCOMMODATION += value;
        } else {
          dayBookedTransport += value;
        }
      }
      bookedTransport += dayBookedTransport;
      for (const entry of day.budgets) {
        const value = convert(entry.amount, entry.currency);
        categories[entry.category] += value;
        overall[entry.category] += value;
        addOriginal(entry.currency, entry.amount);
      }
      for (const activity of day.activities) {
        if (activity.cost === undefined) continue;
        const from = activity.currency ?? itinerary.currency;
        const value = convert(activity.cost, from);
        categories.ACTIVITIES += value;
        overall.ACTIVITIES += value;
        addOriginal(from, activity.cost);
      }
      const dayTransport = dayBookedTransport + itinerary.transportCosts.filter((cost) => cost.dayId?.equals(day._id))
        .reduce((sum, cost) => sum + convert(cost.amount, cost.currency), 0);
      return {
        dayId: day._id.toString(),
        dayNumber: index + 1,
        date: formatDateOnly(dateOfDay(itinerary.startDate, index + 1)),
        city: day.city,
        rawTotal: sumCategories(categories) + dayTransport,
        transport: roundMoney(dayTransport),
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
    const transport = bookedTransport + transportCosts.reduce((sum, cost) => sum + cost.rawConverted, 0);

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
      ...(isOwner ? { linkedBookings: links.map(({ link, booking }): ConvertedLinkedBookingDto => {
        const counts = booking !== null && countsInBudget(booking.status);
        const major = booking ? minorToMajor(booking.amountMinor, booking.currency) : undefined;
        return {
          linkedBookingId: link._id.toString(),
          type: link.type,
          dayId: link.dayId.toString(),
          status: booking?.status ?? null,
          countsInBudget: counts,
          ...(booking ? { label: booking.label, amount: major, currency: booking.currency } : {}),
          convertedAmount: counts ? roundMoney(convert(major!, booking!.currency)) : 0,
        };
      }) } : {}),
      originalTotals: [...originals].sort(([a], [b]) => a.localeCompare(b))
        .map(([code, amount]) => ({ currency: code, amount: roundMoney(amount) })),
      rateDate: table.rateDate ? formatDateOnly(table.rateDate) : null,
      ratesStale: table.stale,
    };
  }

  // ---------------------------------------------------------------- linked bookings (ITN-27, bonus)

  /**
   * Links one of the owner's own CONFIRMED or COMPLETED bookings to a day. The day must fall on
   * the booking's dates: a night of a hotel stay, or a flight's local departure date.
   */
  async linkBooking(itineraryId: string, userId: string, input: CreateLinkedBookingDto): Promise<ItineraryDto> {
    const itinerary = await this.findOwned(itineraryId, userId);
    const dayIndex = itinerary.days.findIndex((day) => day._id.toString() === input.dayId.toLowerCase());
    if (dayIndex < 0) throw fieldError('dayId', 'Day not found in this itinerary');
    const bookingOid = new Types.ObjectId(input.bookingId);
    if (itinerary.linkedBookings.some((link) => link.type === input.type && link.bookingId.equals(bookingOid))) {
      throw new ConflictException('This booking is already linked to this itinerary');
    }
    if (itinerary.linkedBookings.length >= MAX_LINKED_BOOKINGS) {
      throw new ConflictException(`An itinerary can have at most ${MAX_LINKED_BOOKINGS} linked bookings`);
    }
    const booking = await this.bookingPort(input.type).getOwnBooking(input.bookingId, userId);
    if (!countsInBudget(booking.status)) {
      throw fieldError('bookingId', `Only CONFIRMED or COMPLETED bookings can be linked; this one is ${booking.status}`);
    }
    const dayDate = formatDateOnly(dateOfDay(itinerary.startDate, dayIndex + 1));
    if (!bookingCoversDate(input.type, booking, dayDate)) {
      throw fieldError('dayId', `${expectedDays(input.type, booking)}; this day is ${dayDate}`);
    }
    itinerary.linkedBookings.push({
      type: input.type,
      bookingId: bookingOid,
      dayId: itinerary.days[dayIndex]._id,
      linkedAt: new Date(),
    } as unknown as LinkedBooking);
    return this.toDto(await this.persist(itinerary), userId);
  }

  /** Removes the link only; the booking itself is untouched. */
  async unlinkBooking(itineraryId: string, linkedBookingId: string, userId: string): Promise<ItineraryDto> {
    const itinerary = await this.findOwned(itineraryId, userId);
    const linkOid = toObjectId(linkedBookingId, LINK_NOT_FOUND);
    if (!itinerary.linkedBookings.some((link) => link._id.equals(linkOid))) throw new NotFoundException(LINK_NOT_FOUND);
    itinerary.linkedBookings = itinerary.linkedBookings.filter((link) => !link._id.equals(linkOid));
    return this.toDto(await this.persist(itinerary), userId);
  }

  private bookingPort(type: LinkedBookingType): ItineraryBookingsPort {
    return type === LinkedBookingType.HOTEL ? this.hotelBookings : this.flightBookings;
  }

  /**
   * Live booking details for every link, looked up as the itinerary owner. A booking that no
   * longer exists resolves to null; any other failure propagates (no silent partial totals).
   */
  private async resolveLinks(itinerary: ItineraryDocument): Promise<ResolvedLink[]> {
    const ownerId = itinerary.userId.toString();
    return Promise.all((itinerary.linkedBookings ?? []).map(async (link) => {
      try {
        return { link, booking: await this.bookingPort(link.type).getOwnBooking(link.bookingId.toString(), ownerId) };
      } catch (error) {
        if (error instanceof NotFoundException) return { link, booking: null };
        throw error;
      }
    }));
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
    const filter: QueryFilter<Itinerary> = { visibility: ItineraryVisibility.PUBLIC, isHidden: { $ne: true } };
    if (query.q) {
      const pattern = new RegExp(escapeRegex(query.q), 'i');
      const countryCodes = await this.references.matchingCountryCodes(query.q);
      filter.$or = [{ title: pattern }, { description: pattern }, { 'days.city': pattern }, { countries: { $in: countryCodes } }];
    }
    if (query.country) filter.countries = query.country;
    if (query.city) filter['days.city'] = new RegExp(`^${escapeRegex(query.city)}$`, 'i');
    const sizeConditions: unknown[] = [];
    if (query.minDays) sizeConditions.push({ $gte: [{ $size: '$days' }, query.minDays] });
    if (query.maxDays) sizeConditions.push({ $lte: [{ $size: '$days' }, query.maxDays] });
    if (sizeConditions.length > 0) filter.$expr = { $and: sizeConditions };

    const candidateAuthors = (await this.itineraries.distinct('userId', filter).exec()) as Types.ObjectId[];
    const statuses = await this.accountStatuses.getAccountStatuses(candidateAuthors.map((id) => id.toString()));
    const visibleAuthors = candidateAuthors.filter((id) => isVisibleStatus(statuses.get(id.toString())));
    const visibleFilter: QueryFilter<Itinerary> = { ...filter, userId: { $in: visibleAuthors } };

    const sort = SORTS[query.sort ?? PublicItinerarySort.NEWEST];
    const projection = SUMMARY_PROJECTION;
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
    const names = await this.attributionNames(rows, statuses);
    return pageOf(rows.map((row) => ItinerarySummaryDto.from(row, names)), page, total);
  }

  // ---------------------------------------------------------------- read-only views for other modules (BLG-12, BLG-13)

  /**
   * BLG-12 (author page): one author's PUBLIC itineraries, newest published first, as summaries.
   * Applies the same rules as public search: an author who is deactivated or missing (ACC-12)
   * gets an empty page, and only summary fields are read, so nothing private is ever returned.
   */
  async listPublicByAuthor(authorId: string, page = 1): Promise<ItineraryPageDto> {
    if (!Types.ObjectId.isValid(authorId)) return pageOf([], page, 0);
    authorId = new Types.ObjectId(authorId).toString();
    const statuses = await this.accountStatuses.getAccountStatuses([authorId]);
    if (!isVisibleStatus(statuses.get(authorId))) return pageOf([], page, 0);
    const filter: QueryFilter<Itinerary> = { userId: new Types.ObjectId(authorId), visibility: ItineraryVisibility.PUBLIC, isHidden: { $ne: true } };
    const [rows, total] = await Promise.all([
      this.itineraries.find(filter, SUMMARY_PROJECTION).sort({ publishedAt: -1, _id: -1 })
        .skip((page - 1) * ITINERARY_PAGE_SIZE).limit(ITINERARY_PAGE_SIZE).lean<Itinerary[]>().exec(),
      this.itineraries.countDocuments(filter).exec(),
    ]);
    const names = await this.attributionNames(rows, statuses);
    return pageOf(rows.map((row) => ItinerarySummaryDto.from(row, names)), page, total);
  }

  /**
   * BLG-13 (itinerary attached to a post): the summary of one PUBLIC itinerary, or null when it is
   * missing, private, or its author is deactivated or missing (ACC-12). With `authorId`, it must
   * also belong to that user, so a post can only show its own author's itinerary.
   */
  async getPublicSummary(itineraryId: string, authorId?: string): Promise<ItinerarySummaryDto | null> {
    if (!Types.ObjectId.isValid(itineraryId) || (authorId !== undefined && !Types.ObjectId.isValid(authorId))) return null;
    const filter: QueryFilter<Itinerary> = { _id: new Types.ObjectId(itineraryId), visibility: ItineraryVisibility.PUBLIC, isHidden: { $ne: true } };
    if (authorId !== undefined) filter.userId = new Types.ObjectId(authorId);
    const row = await this.itineraries.findOne(filter, SUMMARY_PROJECTION).lean<Itinerary>().exec();
    if (!row) return null;
    const ownerId = row.userId.toString();
    const statuses = await this.accountStatuses.getAccountStatuses([ownerId]);
    if (!isVisibleStatus(statuses.get(ownerId))) return null;
    return ItinerarySummaryDto.from(row, await this.attributionNames([row], statuses));
  }

  // ---------------------------------------------------------------- moderation for administrators (GEN-09, GEN-10)

  /**
   * GEN-09: whether an itinerary can be reported. Only PUBLIC itineraries are reportable, since
   * nobody but the owner can see a private one. Hidden ones still count, so duplicate reports
   * and later reviews keep working. Invalid or unknown ids return false.
   */
  async itineraryExists(itineraryId: string): Promise<boolean> {
    if (!isObjectIdString(itineraryId)) return false;
    return (await this.itineraries.exists({ _id: new Types.ObjectId(itineraryId), visibility: ItineraryVisibility.PUBLIC }).exec()) !== null;
  }

  /**
   * GEN-10: hides or unhides an itinerary after a report. A hidden itinerary disappears from
   * public search, public and direct viewing, cloning, budget summaries, hotel/flight search,
   * images and the blog views; its owner still sees it, flagged `isHidden`. 404 if unknown.
   * Writes only the flag, so a concurrent owner edit is not lost.
   */
  async setItineraryHidden(itineraryId: string, hidden: boolean): Promise<void> {
    const id = toObjectId(itineraryId, NOT_FOUND);
    const result = await this.itineraries.updateOne({ _id: id }, { $set: { isHidden: hidden } }).exec();
    if (result.matchedCount === 0) throw new NotFoundException(NOT_FOUND);
  }

  /** GEN-10: deletes an itinerary and its activity images. 404 if unknown. */
  async adminDeleteItinerary(itineraryId: string): Promise<void> {
    const id = toObjectId(itineraryId, NOT_FOUND);
    const deleted = await this.itineraries.findOneAndDelete({ _id: id }).exec();
    if (!deleted) throw new NotFoundException(NOT_FOUND);
    await this.images.deleteMany({ itineraryId: id }).exec();
  }

  /** ITN-21: an independent private copy. Author status is rechecked at clone time. */
  async clone(itineraryId: string, viewer: NonNullable<Viewer>): Promise<ItineraryDto> {
    const source = await this.findReadable(itineraryId, undefined);
    const sourceAuthorId = source.userId.toString();
    if (!isVisibleStatus((await this.accountStatuses.getAccountStatuses([sourceAuthorId])).get(sourceAuthorId))) {
      throw new NotFoundException(NOT_FOUND);
    }
    const authorName = (await this.authorNames.getDisplayNames([sourceAuthorId])).get(sourceAuthorId) ?? DELETED_USER_NAME;

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
            cost: activity.cost,
            currency: activity.currency,
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
          authorName,
          title: source.title,
          clonedAt: new Date(),
        },
      });
      return this.toDto(clone, viewer.userId);
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
      rooms: query.rooms ?? 1,
      ...(query.page ? { page: query.page } : {}),
    };
    return { itineraryId, criteria, results: await this.hotels.search(criteria) };
  }

  /** ITN-26: one-way/round-trip search into the first day's city via the shared Flights port. */
  async searchFlights(itineraryId: string, viewer: Viewer, query: ItineraryFlightsQueryDto): Promise<SearchResult<ItineraryFlightSearch>> {
    const itinerary = await this.findReadable(itineraryId, viewer);
    const first = itinerary.days[0];
    if (!first) throw fieldError('itinerary', 'Add an itinerary day before searching flights');
    const departure = await this.airports.findByCode(query.departureAirportCode);
    if (!departure) throw fieldError('departureAirportCode', 'Choose an airport from the official catalog');
    const country = (await this.references.listCountries()).find(({ code }) => code === first.countryCode);
    const arrivalAirportCodes = (await this.airports.list()).filter((airport) =>
      airport.city.toLowerCase() === first.city.toLowerCase() && airport.country === country?.name
      && airport.code !== departure.code).map(({ code }) => code);
    if (arrivalAirportCodes.length === 0) throw fieldError('departureAirportCode', 'No different destination airport exists in the first itinerary city');
    const roundTrip = query.roundTrip ?? false;
    if (!roundTrip && query.returnDate) throw fieldError('returnDate', 'A return date requires a round trip');
    const departureDate = query.departureDate ?? formatDateOnly(itinerary.startDate);
    const returnDate = roundTrip ? query.returnDate ?? formatDateOnly(dateOfDay(itinerary.startDate, itinerary.days.length)) : undefined;
    if (returnDate && returnDate < departureDate) throw fieldError('returnDate', 'Return date must not precede departure');
    const adults = query.adults ?? 1;
    const children = query.children ?? 0;
    const infants = query.infants ?? 0;
    if (infants > adults) throw fieldError('infants', 'Infants must not outnumber adults');
    const criteria: ItineraryFlightSearch = {
      departureAirportCode: departure.code, arrivalAirportCodes, roundTrip, departureDate,
      ...(returnDate ? { returnDate } : {}), adults, children, infants,
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
    if (itinerary.visibility !== ItineraryVisibility.PUBLIC || itinerary.isHidden) return false;
    const authorId = itinerary.userId.toString();
    return isVisibleStatus((await this.accountStatuses.getAccountStatuses([authorId])).get(authorId));
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

  private async toDto(itinerary: ItineraryDocument, viewerId?: string): Promise<ItineraryDto> {
    const ownerId = itinerary.userId.toString() === viewerId ? viewerId : undefined;
    const dto = ItineraryDto.fromItinerary(itinerary.toObject() as Itinerary, await this.attributionNames([itinerary], new Map(), ownerId));
    // ITN-27: linked bookings are personal, so only the owner ever sees them.
    if (!ownerId) return dto;
    const links = await this.resolveLinks(itinerary);
    return { ...dto, linkedBookings: links.map((resolved) => linkedBookingDto(itinerary, resolved)) };
  }

  /** Names for authors and clone attributions; deactivated or missing authors show as "Deleted user". */
  private async attributionNames(
    rows: Pick<Itinerary, 'userId' | 'clonedFrom'>[], knownStatuses = new Map<string, AccountStatus>(), ownerId?: string,
  ): Promise<AuthorNames> {
    const ids = [...new Set(rows.flatMap((row) => [row.userId.toString(), ...(row.clonedFrom ? [row.clonedFrom.userId.toString()] : [])]))];
    if (ids.length === 0) return new Map();
    const unknown = ids.filter((id) => id !== ownerId && !knownStatuses.has(id));
    let statuses = knownStatuses;
    try {
      if (unknown.length) statuses = new Map([...knownStatuses, ...(await this.accountStatuses.getAccountStatuses(unknown))]);
    } catch (error) {
      // Only an already authorized owner's own response can omit unavailable attribution.
      // Never use this fallback for public access or to reveal an unknown author's name.
      if (!ownerId || rows.some((row) => row.userId.toString() !== ownerId)) throw error;
    }
    const visible = ids.filter((id) => id === ownerId || isVisibleStatus(statuses.get(id)));
    const names = visible.length > 0 ? await this.authorNames.getDisplayNames(visible) : new Map<string, string>();
    return new Map(ids.map((id) => [id, names.get(id) ?? DELETED_USER_NAME]));
  }

  /**
   * PDF 5.1: an activity may reference only an attraction from the shared seeded catalog (Malak, PR #97),
   * and that attraction must be in the city of the activity's day (e.g. no Louvre on a Cairo day).
   */
  private async assertAttraction(attractionId: string, day: ItineraryDay): Promise<void> {
    const attraction = await this.references.findAttraction(attractionId);
    if (!attraction) {
      throw fieldError('attractionId', `Unknown attraction ${attractionId}. Choose one from GET /api/attractions`);
    }
    const dayCityId = await this.dayCityId(day);
    if (attraction.cityId !== dayCityId) {
      throw fieldError('attractionId', `${attraction.name} is not in ${day.city}. Choose an attraction in this day's city`);
    }
  }

  /** The catalog cityId of a day; null if the stored city no longer resolves (then no attraction can match). */
  private async dayCityId(day: Pick<ItineraryDay, 'city' | 'countryCode'>): Promise<string | null> {
    try {
      return (await this.references.resolveCity(day.city, day.countryCode)).cityId;
    } catch {
      return null;
    }
  }

  /** Changing a day's city must not leave its activities pointing at attractions in the old city. */
  private async assertDayAttractionsIn(day: ItineraryDay, cityId: string): Promise<void> {
    const attractionIds = [...new Set(day.activities.map((activity) => activity.attractionId).filter((id): id is string => !!id))];
    for (const attractionId of attractionIds) {
      const attraction = await this.references.findAttraction(attractionId);
      if (attraction && attraction.cityId !== cityId) {
        throw fieldError('city', `This day has an activity at ${attraction.name}, which is not in the new city. Remove or change that attraction first`);
      }
    }
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
  private async defaultCurrency(userId: string, fallback = 'USD'): Promise<string> {
    const user = await this.users.findById(userId, { preferredCurrency: 1 }).lean().exec();
    const preferred = user?.preferredCurrency?.toUpperCase();
    return preferred && (await this.currencies.isSupported(preferred)) ? preferred : fallback;
  }

  private async activityCost(input: { cost?: number; currency?: string }, fallback: string): Promise<{ cost?: number; currency?: string }> {
    if (input.cost === undefined) {
      if (input.currency !== undefined) throw fieldError('currency', 'An activity currency requires a cost');
      return {};
    }
    return { cost: input.cost, currency: await this.assertCurrency(input.currency ?? fallback, 'currency') };
  }
}

/** Fields a summary needs. Activities, budgets and linked bookings are never read for public lists. */
const SUMMARY_PROJECTION = {
  title: 1, description: 1, countries: 1, startDate: 1, visibility: 1, currency: 1, userId: 1,
  clonedFrom: 1, publishedAt: 1, createdAt: 1, updatedAt: 1, 'days._id': 1, 'days.city': 1, 'days.countryCode': 1,
};

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

function isObjectIdString(id: string): boolean {
  return typeof id === 'string' && Types.ObjectId.isValid(id) && String(new Types.ObjectId(id)) === id.toLowerCase();
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

/** GEN-08: the shared byte check decides the type; the file name and declared type are ignored. */
const IMAGE_CONTENT_TYPES = { jpg: 'image/jpeg', png: 'image/png' } as const;

function detectImageType(buffer: Buffer): string | null {
  const extension = detectImageExtension(buffer);
  return extension ? IMAGE_CONTENT_TYPES[extension] : null;
}

/** ITN-27: only bookings that are actually booked count (and can be linked). */
function countsInBudget(status: BookingStatus): boolean {
  return status === BookingStatus.CONFIRMED || status === BookingStatus.COMPLETED;
}

/** Hotel: check-in ≤ day < check-out (check-out is the departure day). Flight: the departure date. */
function bookingCoversDate(type: LinkedBookingType, booking: LinkableBooking, date: string): boolean {
  if (type === LinkedBookingType.HOTEL) return booking.startDate <= date && booking.endDate !== undefined && date < booking.endDate;
  return date === booking.startDate;
}

function expectedDays(type: LinkedBookingType, booking: LinkableBooking): string {
  if (type === LinkedBookingType.FLIGHT) return `Pick the day dated ${booking.startDate} (the flight's departure date)`;
  const lastNight = booking.endDate ? formatDateOnly(new Date(parseDateOnly(booking.endDate).getTime() - DAY_MS)) : booking.startDate;
  return `Pick a day from ${booking.startDate} to ${lastNight} (the nights of this stay)`;
}

function linkedBookingDto(itinerary: ItineraryDocument, { link, booking }: ResolvedLink): LinkedBookingDto {
  const base = {
    linkedBookingId: link._id.toString(),
    type: link.type,
    bookingId: link.bookingId.toString(),
    dayId: link.dayId.toString(),
    linkedAt: link.linkedAt,
  };
  if (!booking) return { ...base, status: null, countsInBudget: false };
  const dayIndex = itinerary.days.findIndex((day) => day._id.equals(link.dayId));
  return {
    ...base,
    status: booking.status,
    countsInBudget: countsInBudget(booking.status),
    label: booking.label,
    ...(booking.bookingReference ? { bookingReference: booking.bookingReference } : {}),
    amount: minorToMajor(booking.amountMinor, booking.currency),
    currency: booking.currency,
    startDate: booking.startDate,
    ...(booking.endDate ? { endDate: booking.endDate } : {}),
    ...(dayIndex >= 0 ? { matchesDay: bookingCoversDate(link.type, booking, formatDateOnly(dateOfDay(itinerary.startDate, dayIndex + 1))) } : {}),
  };
}
