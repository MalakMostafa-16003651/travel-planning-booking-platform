import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsMongoId, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { COUNTRY_CODE, CURRENCY_CODE, Trim, TrimUpper } from './transforms';

export class PageQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page must be a whole number' })
  @Min(1, { message: 'Page must be at least 1' })
  page?: number;
}

export enum PublicItinerarySort {
  NEWEST = 'NEWEST',
  OLDEST = 'OLDEST',
  TITLE = 'TITLE',
  SHORTEST = 'SHORTEST',
  LONGEST = 'LONGEST',
}

/** ITN-20, ITN-21 */
export class SearchPublicItinerariesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Matches title, description or city, case-insensitive.' })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 100, { message: 'Search text must be 1 to 100 characters' })
  q?: string;

  @ApiPropertyOptional({ example: 'EG' })
  @IsOptional()
  @TrimUpper()
  @Matches(COUNTRY_CODE, { message: 'Country must be a two-letter code' })
  country?: string;

  @ApiPropertyOptional({ example: 'Luxor' })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 100, { message: 'City must be 1 to 100 characters' })
  city?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'minDays must be a whole number' })
  @Min(1, { message: 'minDays must be at least 1' })
  minDays?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'maxDays must be a whole number' })
  @Min(1, { message: 'maxDays must be at least 1' })
  maxDays?: number;

  @ApiPropertyOptional({ enum: PublicItinerarySort, default: PublicItinerarySort.NEWEST })
  @IsOptional()
  @IsEnum(PublicItinerarySort, { message: 'Sort must be NEWEST, OLDEST, TITLE, SHORTEST or LONGEST' })
  sort?: PublicItinerarySort;
}

/** ITN-18 */
export class BudgetSummaryQueryDto {
  @ApiPropertyOptional({ example: 'EUR', description: "Display currency. Defaults to the itinerary's currency." })
  @IsOptional()
  @TrimUpper()
  @Matches(CURRENCY_CODE, { message: 'Currency must be a three-letter code' })
  currency?: string;
}

/** ITN-25: hotel search for a city stop, reusing HTL-11/HTL-12. */
export class ItineraryHotelsQueryDto extends PageQueryDto {
  @ApiProperty({ description: 'Any day of the stop to search hotels for. Check-in/out come from that stop.' })
  @IsMongoId({ message: 'dayId must be a valid id' })
  dayId!: string;

  @ApiPropertyOptional({ example: 2, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Guests must be a whole number' })
  @Min(1, { message: 'Guests must be at least 1' })
  @Max(20, { message: 'Guests must be at most 20' })
  guests?: number;
}

/** ITN-26 */
export class ItineraryFlightsQueryDto extends PageQueryDto {
  @ApiProperty({ description: 'The day you arrive in a new city. The flight leaves from the previous stop on that date.' })
  @IsMongoId({ message: 'dayId must be a valid id' })
  dayId!: string;

  @ApiPropertyOptional({ example: 'Berlin', description: 'Required when dayId is the first day (there is no previous stop).' })
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 100, { message: 'originCity must be 1 to 100 characters' })
  originCity?: string;

  @ApiPropertyOptional({ example: 'DE' })
  @IsOptional()
  @TrimUpper()
  @Matches(COUNTRY_CODE, { message: 'originCountryCode must be a two-letter code' })
  originCountryCode?: string;

  @ApiPropertyOptional({ default: 1, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt() @Min(0) @Max(9)
  adults?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt() @Min(0) @Max(9)
  children?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt() @Min(0) @Max(9)
  infants?: number;

  @ApiPropertyOptional({ example: 'ECONOMY' })
  @IsOptional()
  @TrimUpper()
  @IsString()
  @Length(1, 30)
  cabinClass?: string;
}
