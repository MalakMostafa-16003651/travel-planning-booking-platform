import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { DATE_ONLY } from './transforms';

/** HTL-15. */
export class AvailableRoomsQueryDto {
  @ApiProperty({ example: '2026-12-20' })
  @Matches(DATE_ONLY, { message: 'checkIn must be YYYY-MM-DD' })
  checkIn!: string;

  @ApiProperty({ example: '2026-12-27' })
  @Matches(DATE_ONLY, { message: 'checkOut must be YYYY-MM-DD' })
  checkOut!: string;

  @ApiPropertyOptional({ example: 2, minimum: 1, description: 'Only rooms with at least this capacity are returned.' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  guests?: number;
}
