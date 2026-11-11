import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsISO8601, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { DATE_ONLY } from './transforms';

/** HTL-02: optional stay dates; with both, the hotel details include the rooms available for that stay. */
export class HotelDetailQueryDto {
  @ApiPropertyOptional({ example: '2026-12-20', description: 'With checkOut, also return availableRooms for the stay.' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'checkIn must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'checkIn must be a real calendar date' })
  checkIn?: string;

  @ApiPropertyOptional({ example: '2026-12-27' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'checkOut must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'checkOut must be a real calendar date' })
  checkOut?: string;

  @ApiPropertyOptional({ example: 2, minimum: 1, description: 'Only rooms with at least this maximum occupancy.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  guests?: number;
}
