import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BudgetCategory, CityGroup, dateOfDay, formatDateOnly, groupDaysByCity, ItineraryVisibility, TransportMode } from '../itinerary.rules';
import { Activity, BudgetEntry, Itinerary, ItineraryDay, TransportCost } from '../schemas/itinerary.schema';

export const DELETED_USER_NAME = 'Deleted user';

export class ActivityImageDto {
  @ApiProperty() imageId!: string;
  @ApiProperty({ example: '/api/activities/665f.../images/6660...' }) url!: string;
  @ApiProperty({ example: 'image/jpeg' }) contentType!: string;
  @ApiProperty({ example: 182044 }) size!: number;
}

export class ActivityDto {
  @ApiProperty() activityId!: string;
  @ApiProperty() dayId!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() description?: string;
  @ApiPropertyOptional() location?: string;
  @ApiPropertyOptional() attractionId?: string;
  @ApiPropertyOptional({ example: '09:30' }) startTime?: string;
  @ApiPropertyOptional({ example: '12:00' }) endTime?: string;
  @ApiPropertyOptional() cost?: number;
  @ApiPropertyOptional() currency?: string;
  @ApiProperty({ type: [ActivityImageDto] }) images!: ActivityImageDto[];

  static from(activity: Activity, dayId: string): ActivityDto {
    const activityId = activity._id.toString();
    return {
      activityId,
      dayId,
      title: activity.title,
      ...optional('description', activity.description),
      ...optional('location', activity.location),
      ...optional('attractionId', activity.attractionId),
      ...optional('startTime', activity.startTime),
      ...optional('endTime', activity.endTime),
      ...optional('cost', activity.cost),
      ...optional('currency', activity.currency),
      images: (activity.images ?? []).map((image) => ({
        imageId: image._id.toString(),
        url: `/api/activities/${activityId}/images/${image._id.toString()}`,
        contentType: image.contentType,
        size: image.size,
      })),
    };
  }
}

export class BudgetEntryDto {
  @ApiProperty() budgetId!: string;
  @ApiProperty() dayId!: string;
  @ApiProperty({ enum: BudgetCategory }) category!: BudgetCategory;
  @ApiProperty({ example: 450.5 }) amount!: number;
  @ApiProperty({ example: 'EGP' }) currency!: string;
  @ApiPropertyOptional() description?: string;

  static from(entry: BudgetEntry, dayId: string): BudgetEntryDto {
    return {
      budgetId: entry._id.toString(),
      dayId,
      category: entry.category,
      amount: entry.amount,
      currency: entry.currency,
      ...optional('description', entry.description),
    };
  }
}

export class TransportCostDto {
  @ApiProperty() transportCostId!: string;
  @ApiProperty() fromCity!: string;
  @ApiProperty() toCity!: string;
  @ApiProperty({ enum: TransportMode }) mode!: TransportMode;
  @ApiProperty() amount!: number;
  @ApiProperty() currency!: string;
  @ApiPropertyOptional({ description: 'Present only while the linked day still exists.' }) dayId?: string;
  @ApiPropertyOptional({ description: 'Current number of the linked day.' }) dayNumber?: number;
  @ApiPropertyOptional() date?: string;
  @ApiPropertyOptional() notes?: string;

  static from(cost: TransportCost, itinerary: Pick<Itinerary, 'days' | 'startDate'>): TransportCostDto {
    const linkedIndex = cost.dayId ? itinerary.days.findIndex((day) => day._id.equals(cost.dayId)) : -1;
    return {
      transportCostId: cost._id.toString(),
      fromCity: cost.fromCity,
      toCity: cost.toCity,
      mode: cost.mode,
      amount: cost.amount,
      currency: cost.currency,
      ...(linkedIndex >= 0 ? {
        dayId: cost.dayId!.toString(),
        dayNumber: linkedIndex + 1,
        date: formatDateOnly(dateOfDay(itinerary.startDate, linkedIndex + 1)),
      } : {}),
      ...optional('notes', cost.notes),
    };
  }
}

export class ItineraryDayDto {
  @ApiProperty() dayId!: string;
  @ApiProperty({ example: 1, description: 'Derived from the day order.' }) dayNumber!: number;
  @ApiProperty({ example: '2026-12-20', description: 'startDate + (dayNumber - 1).' }) date!: string;
  @ApiProperty() city!: string;
  @ApiPropertyOptional() countryCode?: string;
  @ApiPropertyOptional() notes?: string;
  @ApiProperty({ type: [ActivityDto] }) activities!: ActivityDto[];
  @ApiProperty({ type: [BudgetEntryDto] }) budgets!: BudgetEntryDto[];

  static from(day: ItineraryDay, index: number, startDate: Date): ItineraryDayDto {
    const dayId = day._id.toString();
    return {
      dayId,
      dayNumber: index + 1,
      date: formatDateOnly(dateOfDay(startDate, index + 1)),
      city: day.city,
      ...optional('countryCode', day.countryCode),
      ...optional('notes', day.notes),
      activities: (day.activities ?? []).map((activity) => ActivityDto.from(activity, dayId)),
      budgets: (day.budgets ?? []).map((entry) => BudgetEntryDto.from(entry, dayId)),
    };
  }
}

export class CityGroupDto implements CityGroup {
  @ApiProperty() city!: string;
  @ApiPropertyOptional() countryCode?: string;
  @ApiProperty() firstDayNumber!: number;
  @ApiProperty() lastDayNumber!: number;
  @ApiProperty() startDate!: string;
  @ApiProperty() endDate!: string;
  @ApiProperty() dayCount!: number;
  @ApiProperty({ type: [String] }) dayIds!: string[];
}

export class ClonedFromDto {
  @ApiProperty() itineraryId!: string;
  @ApiProperty() userId!: string;
  @ApiProperty({ description: `Original author's name, or "${DELETED_USER_NAME}".` }) authorName!: string;
  @ApiProperty() title!: string;
  @ApiProperty() clonedAt!: Date;
}

export class ItineraryAuthorDto {
  @ApiProperty() userId!: string;
  @ApiProperty() name!: string;
}

/** Fields shared by list items and full itineraries. */
export class ItinerarySummaryDto {
  @ApiProperty() itineraryId!: string;
  @ApiProperty() userId!: string;
  @ApiPropertyOptional({ type: ItineraryAuthorDto }) author?: ItineraryAuthorDto;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty({ type: [String], example: ['EG'] }) countries!: string[];
  @ApiProperty({ type: [String], description: 'Distinct cities in visiting order.' }) cities!: string[];
  @ApiProperty({ example: '2026-12-20' }) startDate!: string;
  @ApiPropertyOptional({ example: '2026-12-27', description: 'Date of the last day; absent with no days.' }) endDate?: string;
  @ApiProperty() dayCount!: number;
  @ApiProperty({ enum: ItineraryVisibility }) visibility!: ItineraryVisibility;
  @ApiProperty({ example: 'USD' }) currency!: string;
  @ApiPropertyOptional({ type: ClonedFromDto }) clonedFrom?: ClonedFromDto;
  @ApiPropertyOptional({ nullable: true }) publishedAt?: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static from(itinerary: Itinerary, names: AuthorNames = new Map()): ItinerarySummaryDto {
    const days = itinerary.days ?? [];
    const cities: string[] = [];
    for (const day of days) {
      if (!cities.some((city) => city.toLowerCase() === day.city.toLowerCase())) cities.push(day.city);
    }
    const ownerId = itinerary.userId.toString();
    const ownerName = names.get(ownerId);
    return {
      itineraryId: itinerary._id.toString(),
      userId: ownerId,
      ...(ownerName !== undefined ? { author: { userId: ownerId, name: ownerName } } : {}),
      title: itinerary.title,
      ...optional('description', itinerary.description),
      countries: itinerary.countries,
      cities,
      startDate: formatDateOnly(itinerary.startDate),
      ...(days.length > 0 ? { endDate: formatDateOnly(dateOfDay(itinerary.startDate, days.length)) } : {}),
      dayCount: days.length,
      visibility: itinerary.visibility,
      currency: itinerary.currency,
      ...(itinerary.clonedFrom ? {
        clonedFrom: {
          itineraryId: itinerary.clonedFrom.itineraryId.toString(),
          userId: itinerary.clonedFrom.userId.toString(),
          authorName: names.get(itinerary.clonedFrom.userId.toString()) ?? itinerary.clonedFrom.authorName,
          title: itinerary.clonedFrom.title,
          clonedAt: itinerary.clonedFrom.clonedAt,
        },
      } : {}),
      publishedAt: itinerary.publishedAt ?? null,
      createdAt: itinerary.createdAt,
      updatedAt: itinerary.updatedAt,
    };
  }
}

/** userId -> display name; DELETED_USER_NAME for deactivated accounts (ACC-12). */
export type AuthorNames = Map<string, string>;

export class ItineraryDto extends ItinerarySummaryDto {
  @ApiProperty({ type: [ItineraryDayDto] }) days!: ItineraryDayDto[];
  @ApiProperty({ type: [CityGroupDto], description: 'Consecutive days in the same city, recomputed after every change.' }) cityGroups!: CityGroupDto[];
  @ApiProperty({ type: [TransportCostDto] }) transportCosts!: TransportCostDto[];

  static fromItinerary(itinerary: Itinerary, names?: AuthorNames): ItineraryDto {
    return {
      ...ItinerarySummaryDto.from(itinerary, names),
      days: itinerary.days.map((day, index) => ItineraryDayDto.from(day, index, itinerary.startDate)),
      cityGroups: cityGroupsOf(itinerary),
      transportCosts: itinerary.transportCosts.map((cost) => TransportCostDto.from(cost, itinerary)),
    };
  }
}

export class ItineraryPageDto {
  @ApiProperty({ type: [ItinerarySummaryDto] }) items!: ItinerarySummaryDto[];
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export function cityGroupsOf(itinerary: Pick<Itinerary, 'days' | 'startDate'>): CityGroup[] {
  return groupDaysByCity(
    itinerary.startDate,
    itinerary.days.map((day) => ({ dayId: day._id.toString(), city: day.city, countryCode: day.countryCode })),
  );
}

function optional<K extends string, V>(key: K, value: V | undefined | null): Partial<Record<K, V>> {
  return value === undefined || value === null || value === '' ? {} : { [key]: value } as Record<K, V>;
}
