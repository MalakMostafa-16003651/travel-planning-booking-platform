import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { DATE_ONLY } from './transforms';

export class BlockRoomDatesDto {
  @ApiProperty({ example: '2026-12-20', description: 'Check-in date, inclusive.' })
  @IsISO8601({strict:true}) @Matches(DATE_ONLY, { message: 'startDate must be YYYY-MM-DD' })
  startDate!: string;

  @ApiProperty({ example: '2026-12-27', description: 'Check-out date, exclusive (the last blocked night ends the day before).' })
  @IsISO8601({strict:true}) @Matches(DATE_ONLY, { message: 'endDate must be YYYY-MM-DD' })
  endDate!: string;

  @ApiPropertyOptional({ example: 'Annual maintenance', maxLength: 200 })
  @IsOptional() @IsString() @MaxLength(200)
  reason?: string;
}
