import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

/**
 * HTL-20 groups. Only CANCELLED exists for now: UPCOMING and PAST depend on the "today" rule
 * (hotel time zone), which is still to be agreed with Person 5 (contract question L2).
 */
export enum HotelBookingGroup {
  CANCELLED = 'CANCELLED',
}

export class ListHotelBookingsQueryDto {
  @ApiPropertyOptional({
    enum: HotelBookingGroup,
    description: 'HTL-20 grouping. CANCELLED includes expired holds. Without a group, all your reservations are listed. UPCOMING and PAST follow once the time-zone rule is agreed.',
  })
  @IsOptional()
  @IsEnum(HotelBookingGroup, { message: 'Group must be CANCELLED' })
  group?: HotelBookingGroup;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page must be a whole number' })
  @Min(1, { message: 'Page must be at least 1' })
  page?: number;
}
