import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min, MinLength } from 'class-validator';
import { DATE_ONLY } from './transforms';

export enum HotelSearchSort {
  PRICE_ASC = 'PRICE_ASC',
  PRICE_DESC = 'PRICE_DESC',
  NAME = 'NAME',
}

/** HTL-11, HTL-12. Field names match ItineraryHotelSearch (itineraries/ports/travel-search.port.ts) exactly. */
export class SearchHotelsQueryDto {
  @ApiProperty({ example: 'Cairo' })
  @IsString() @MinLength(1)
  city!: string;

  @ApiPropertyOptional({ example: 'EG' })
  @IsOptional() @IsString() @Matches(/^[A-Z]{2}$/)
  countryCode?: string;

  @ApiProperty({ example: '2026-12-20' })
  @Matches(DATE_ONLY, { message: 'checkIn must be YYYY-MM-DD' })
  checkIn!: string;

  @ApiProperty({ example: '2026-12-27' })
  @Matches(DATE_ONLY, { message: 'checkOut must be YYYY-MM-DD' })
  checkOut!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @Type(() => Number) @IsInt() @Min(1) @Max(50)
  guests!: number;

  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20)
  rooms?: number;

  @ApiPropertyOptional({ description: 'Minimum nightly price of the cheapest qualifying room, integer minor units.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ description: 'Maximum nightly price of the cheapest qualifying room, integer minor units.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ enum: HotelSearchSort, default: HotelSearchSort.NAME })
  @IsOptional() @IsEnum(HotelSearchSort, { message: 'sort must be PRICE_ASC, PRICE_DESC or NAME' })
  sort?: HotelSearchSort;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;
}
