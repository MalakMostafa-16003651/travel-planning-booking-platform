import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export enum FlightBookingGroup {
  UPCOMING = 'UPCOMING',
  PAST = 'PAST',
  CANCELLED = 'CANCELLED',
}

export class ListFlightBookingsQueryDto {
  @ApiPropertyOptional({ enum: FlightBookingGroup, description: 'FLT-25 grouping. Expired holds appear under CANCELLED.' })
  @IsOptional()
  @IsEnum(FlightBookingGroup, { message: 'Group must be UPCOMING, PAST or CANCELLED' })
  group?: FlightBookingGroup;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page must be a whole number' })
  @Min(1, { message: 'Page must be at least 1' })
  page?: number;
}
