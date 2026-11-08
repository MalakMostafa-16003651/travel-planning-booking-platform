import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

/** HTL-20 groups. "Today" is the server's UTC calendar date (agreed with Person 5, contract L2). */
export enum HotelBookingGroup {
  UPCOMING = 'UPCOMING',
  PAST = 'PAST',
  CANCELLED = 'CANCELLED',
}

export class ListHotelBookingsQueryDto {
  @ApiPropertyOptional({
    enum: HotelBookingGroup,
    description: 'HTL-20 grouping, using the UTC calendar date. UPCOMING: Pending or Confirmed stays whose check-out is after today (ongoing stays included), nearest check-in first. PAST: Completed stays, plus Confirmed ones whose check-out date has arrived, latest check-out first. CANCELLED: cancelled and expired reservations. Without a group, all your reservations are listed, newest first.',
  })
  @IsOptional()
  @IsEnum(HotelBookingGroup, { message: 'Group must be UPCOMING, PAST or CANCELLED' })
  group?: HotelBookingGroup;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page must be a whole number' })
  @Min(1, { message: 'Page must be at least 1' })
  page?: number;
}
