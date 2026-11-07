import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsMongoId } from 'class-validator';
import { BOOKING_TYPES } from '../booking-ref';
import type { BookingType } from '../bookings-port';

export class BookingParamsDto {
  @ApiProperty({ enum: BOOKING_TYPES })
  @IsIn(BOOKING_TYPES, { message: 'type must be flight or hotel' })
  type!: BookingType;

  @ApiProperty({ description: 'flightBookingId or hotelBookingId', example: '507f1f77bcf86cd799439011' })
  @IsMongoId({ message: 'id must be a valid id' })
  id!: string;
}
