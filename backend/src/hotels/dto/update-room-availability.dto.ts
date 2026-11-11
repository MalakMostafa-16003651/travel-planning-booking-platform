import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsBoolean, IsMongoId, IsOptional, Matches, ValidateIf } from 'class-validator';
import { DATE_ONLY } from './transforms';

/** HTL-05 (edit a blocked range's dates) and HTL-06 (unblock it) in one endpoint, per the official endpoint list. */
export class UpdateRoomAvailabilityDto {
  @ApiProperty({ description: 'The blocked range to edit or remove.' })
  @IsMongoId({ message: 'blockedRangeId must be a valid id' })
  blockedRangeId!: string;

  @ApiPropertyOptional({ example: '2026-12-21', description: 'With endDate, replaces the blocked range. Omit both and set remove to unblock it instead.' })
  @ValidateIf((_object, value) => value !== undefined) @IsISO8601({strict:true}) @Matches(DATE_ONLY, { message: 'startDate must be YYYY-MM-DD' })
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-12-26' })
  @ValidateIf((_object, value) => value !== undefined) @IsISO8601({strict:true}) @Matches(DATE_ONLY, { message: 'endDate must be YYYY-MM-DD' })
  endDate?: string;

  @ApiPropertyOptional({ description: 'Set to true to unblock (remove) the range instead of editing its dates.' })
  @IsOptional() @IsBoolean()
  remove?: boolean;
}
