import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsISO8601, IsOptional, Min } from 'class-validator';
import { BookingStatus } from '../../common/enums/booking-status.enum';

export const BOOKING_TYPES = ['FLIGHT', 'HOTEL'] as const;
export type BookingType = (typeof BOOKING_TYPES)[number];

export class ListAdminBookingsQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page must be a whole number' })
  @Min(1, { message: 'Page must be at least 1' })
  page?: number;

  @ApiPropertyOptional({ enum: BOOKING_TYPES, default: 'FLIGHT', description: 'FLIGHT (default) or HOTEL. The date range applies to departure (flights) or check-in date (hotels).' })
  @IsOptional()
  @IsIn(BOOKING_TYPES, { message: 'Type must be FLIGHT or HOTEL' })
  type?: BookingType;

  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus, { message: 'Status is not a known booking status' })
  status?: BookingStatus;

  @ApiPropertyOptional({ example: '2026-12-01', description: 'Earliest travel date, inclusive (ISO 8601). For hotels only the calendar date (UTC) is used.' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'From must be an ISO 8601 date' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59Z', description: 'Latest travel date, inclusive (ISO 8601). For hotels only the calendar date (UTC) is used.' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'To must be an ISO 8601 date' })
  to?: string;
}
