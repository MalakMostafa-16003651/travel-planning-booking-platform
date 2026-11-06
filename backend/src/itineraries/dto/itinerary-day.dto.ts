import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, ArrayUnique, IsArray, IsInt, IsMongoId, IsOptional, IsString, Length, Matches, MaxLength, Min } from 'class-validator';
import { COUNTRY_CODE, Trim, TrimUpper } from './transforms';

export class CreateItineraryDayDto {
  @ApiProperty({ example: 'Cairo' })
  @Trim()
  @IsString({ message: 'City must be text' })
  @Length(1, 100, { message: 'City must be 1 to 100 characters' })
  city!: string;

  @ApiPropertyOptional({ example: 'EG' })
  @IsOptional()
  @TrimUpper()
  @Matches(COUNTRY_CODE, { message: 'Country must be a two-letter code' })
  countryCode?: string;

  @ApiPropertyOptional({ example: 'Arrive and rest', maxLength: 2000 })
  @IsOptional()
  @Trim()
  @IsString({ message: 'Notes must be text' })
  @MaxLength(2000, { message: 'Notes must be at most 2000 characters' })
  notes?: string;

  @ApiPropertyOptional({ example: 2, minimum: 1, description: 'Insert as this day number. Defaults to the end. Later days shift by one.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Position must be a whole number' })
  @Min(1, { message: 'Position must be at least 1' })
  position?: number;
}

export class UpdateItineraryDayDto extends PartialType(OmitType(CreateItineraryDayDto, ['position'] as const), { skipNullProperties: false }) {}

export class ReorderItineraryDaysDto {
  @ApiProperty({ type: [String], description: 'Every dayId of the itinerary, in the new order.' })
  @IsArray({ message: 'dayIds must be a list' })
  @ArrayMinSize(1, { message: 'dayIds must not be empty' })
  @ArrayUnique({ message: 'dayIds must not repeat' })
  @IsMongoId({ each: true, message: 'Each dayId must be a valid id' })
  dayIds!: string[];
}
