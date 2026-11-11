import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches, MaxLength, IsNumber, Min, Max, ValidateIf } from 'class-validator';
import { CURRENCY_CODE, TIME_OF_DAY, Trim, TrimUpper } from './transforms';
import { MAX_AMOUNT } from '../itinerary.rules';

export class CreateActivityDto {
  @ApiProperty({ example: 'Visit the Egyptian Museum' })
  @Trim()
  @IsString({ message: 'Title must be text' })
  @Length(1, 120, { message: 'Title must be 1 to 120 characters' })
  title!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Trim()
  @IsString({ message: 'Description must be text' })
  @MaxLength(2000, { message: 'Description must be at most 2000 characters' })
  description?: string;

  @ApiPropertyOptional({ example: 'Tahrir Square' })
  @IsOptional()
  @Trim()
  @IsString({ message: 'Location must be text' })
  @MaxLength(200, { message: 'Location must be at most 200 characters' })
  location?: string;

  @ApiPropertyOptional({ example: 'att-1', description: 'Optional attraction from the shared catalog (GET /api/attractions), in the city of this day. Unknown or other-city ids are rejected with 400. On update, null removes it.', nullable: true })
  @IsOptional()
  @Trim()
  @IsString({ message: 'attractionId must be text' })
  @Length(1, 64, { message: 'attractionId must be 1 to 64 characters' })
  attractionId?: string;

  @ApiPropertyOptional({ example: '09:30', description: 'Local time HH:mm' })
  @IsOptional()
  @Matches(TIME_OF_DAY, { message: 'Start time must be HH:mm' })
  startTime?: string;

  @ApiPropertyOptional({ example: '12:00', description: 'Local time HH:mm, not before startTime' })
  @IsOptional()
  @Matches(TIME_OF_DAY, { message: 'End time must be HH:mm' })
  endTime?: string;

  @ApiPropertyOptional({ minimum: 0, description: 'Optional activity cost, included once under Activities in budget totals.' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0) @Max(MAX_AMOUNT)
  cost?: number;

  @ApiPropertyOptional({ description: 'Cost currency from the shared catalog; defaults to itinerary currency when a cost is supplied.' })
  @ValidateIf((_object, value) => value !== undefined)
  @TrimUpper() @Matches(CURRENCY_CODE)
  currency?: string;
}

export class UpdateActivityDto extends PartialType(CreateActivityDto, { skipNullProperties: false }) {}
