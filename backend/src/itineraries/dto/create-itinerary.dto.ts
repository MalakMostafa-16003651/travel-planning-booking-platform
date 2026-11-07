import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEnum, IsISO8601, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf } from 'class-validator';
import { ItineraryVisibility } from '../itinerary.rules';
import { COUNTRY_CODE, CURRENCY_CODE, DATE_ONLY, Trim, TrimUpper, TrimUpperEach } from './transforms';

export class CreateItineraryDto {
  @ApiProperty({ example: 'Two weeks in Egypt', maxLength: 100 })
  @Trim()
  @IsString({ message: 'Title must be text' })
  @Length(1, 100, { message: 'Title must be 1 to 100 characters' })
  title!: string;

  @ApiPropertyOptional({ example: 'Cairo, Luxor and the Red Sea', maxLength: 2000 })
  @IsOptional()
  @Trim()
  @IsString({ message: 'Description must be text' })
  @MaxLength(2000, { message: 'Description must be at most 2000 characters' })
  description?: string;

  @ApiProperty({ example: ['EG'], description: 'ISO 3166-1 alpha-2 country codes.' })
  @TrimUpperEach()
  @IsArray({ message: 'Countries must be a list' })
  @ArrayMinSize(1, { message: 'At least one country is required' })
  @ArrayMaxSize(30, { message: 'At most 30 countries are allowed' })
  @ArrayUnique({ message: 'Countries must not repeat' })
  @Matches(COUNTRY_CODE, { each: true, message: 'Each country must be a two-letter code' })
  countries!: string[];

  @ApiProperty({ example: '2026-12-20', description: 'First day of the trip (YYYY-MM-DD). Day dates are derived from it.' })
  @Matches(DATE_ONLY, { message: 'Start date must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'Start date must be a real calendar date' })
  startDate!: string;

  @ApiPropertyOptional({ enum: ItineraryVisibility, default: ItineraryVisibility.PRIVATE })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(ItineraryVisibility, { message: 'Visibility must be PRIVATE or PUBLIC' })
  visibility?: ItineraryVisibility;

  @ApiPropertyOptional({ example: 'EGP', description: "Default budget display currency. Defaults to the user's preferred currency, else USD." })
  @ValidateIf((_object, value) => value !== undefined)
  @TrimUpper()
  @Matches(CURRENCY_CODE, { message: 'Currency must be a three-letter code' })
  currency?: string;
}
