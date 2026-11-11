import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsMongoId } from 'class-validator';
import { BOOKING_TYPES } from '../booking-ref';
import type { BookingType } from '../bookings-port';

/** Only the booking is sent. Amount and currency always come from the booking. */
export class CreatePaymentDto {
  @ApiProperty({ enum: BOOKING_TYPES, example: 'flight' })
  @IsIn(BOOKING_TYPES, { message: 'bookingType must be flight, hotel or flight-change' })
  bookingType!: BookingType;

  @ApiProperty({ description: 'flightBookingId, hotelBookingId or flightBookingChangeId', example: '507f1f77bcf86cd799439011' })
  @IsMongoId({ message: 'bookingId must be a valid id' })
  bookingId!: string;
}
