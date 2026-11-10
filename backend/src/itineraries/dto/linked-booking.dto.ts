import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { LinkedBookingType } from '../itinerary.rules';

/** ITN-27 (bonus): POST /api/itineraries/:id/bookings */
export class CreateLinkedBookingDto {
  @ApiProperty({ enum: LinkedBookingType, example: LinkedBookingType.HOTEL })
  @IsEnum(LinkedBookingType, { message: 'type must be FLIGHT or HOTEL' })
  type!: LinkedBookingType;

  @ApiProperty({ description: 'Your own flightBookingId or hotelBookingId. Must be CONFIRMED or COMPLETED.' })
  @IsMongoId({ message: 'bookingId must be a valid id' })
  bookingId!: string;

  @ApiProperty({ description: 'Itinerary day. Hotel: a night of the stay (check-in ≤ day < check-out). Flight: the departure date.' })
  @IsMongoId({ message: 'dayId must be a valid id' })
  dayId!: string;
}

/** A linked booking with its live status and amount, shown only to the itinerary owner. */
export class LinkedBookingDto {
  @ApiProperty() linkedBookingId!: string;
  @ApiProperty({ enum: LinkedBookingType }) type!: LinkedBookingType;
  @ApiProperty() bookingId!: string;
  @ApiProperty() dayId!: string;
  @ApiProperty() linkedAt!: Date;
  @ApiPropertyOptional({ enum: BookingStatus, nullable: true, description: 'Live status; null if the booking no longer exists.' })
  status!: BookingStatus | null;
  @ApiProperty({ description: 'True while the booking is CONFIRMED or COMPLETED, so it counts in the budget.' }) countsInBudget!: boolean;
  @ApiPropertyOptional({ description: 'Hotel name or flight numbers.' }) label?: string;
  @ApiPropertyOptional() bookingReference?: string;
  @ApiPropertyOptional({ example: 250.5, description: 'Booking price in major units (2 decimals for USD).' }) amount?: number;
  @ApiPropertyOptional({ example: 'USD' }) currency?: string;
  @ApiPropertyOptional({ example: '2026-12-20' }) startDate?: string;
  @ApiPropertyOptional({ example: '2026-12-23', description: 'Hotel check-out (departure day).' }) endDate?: string;
  @ApiPropertyOptional({ description: "False if reordering days or changing the start date moved this day off the booking's dates." })
  matchesDay?: boolean;
}

/** One linked booking in the budget summary, converted to the summary currency. */
export class ConvertedLinkedBookingDto {
  @ApiProperty() linkedBookingId!: string;
  @ApiProperty({ enum: LinkedBookingType }) type!: LinkedBookingType;
  @ApiProperty() dayId!: string;
  @ApiPropertyOptional({ enum: BookingStatus, nullable: true }) status!: BookingStatus | null;
  @ApiProperty() countsInBudget!: boolean;
  @ApiPropertyOptional() label?: string;
  @ApiPropertyOptional({ description: 'Booking price in major units, in its own currency.' }) amount?: number;
  @ApiPropertyOptional() currency?: string;
  @ApiProperty({ description: 'Amount in the summary currency; 0 when it does not count.' }) convertedAmount!: number;
}
