import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { BOOKING_TYPES, BookingType } from './list-admin-bookings-query.dto';

export class AdminBookingDto {
  @ApiProperty({ enum: BOOKING_TYPES }) type!: BookingType;
  @ApiProperty() bookingId!: string;
  @ApiPropertyOptional({ description: 'Absent until the booking is confirmed.' }) bookingReference?: string;
  @ApiProperty() userId!: string;
  @ApiPropertyOptional() userName?: string;
  @ApiPropertyOptional() userEmail?: string;
  @ApiProperty() providerId!: string;
  @ApiPropertyOptional({ description: 'Airline or hotel name.' }) providerName?: string;
  @ApiProperty({ description: 'Departure (flights) or check-in (hotels).' }) startDate!: Date;
  @ApiProperty() totalAmount!: number;
  @ApiProperty({ example: 'EGP' }) currency!: string;
  @ApiProperty({ enum: BookingStatus }) status!: BookingStatus;
}

export class AdminBookingPageDto {
  @ApiProperty({ type: AdminBookingDto, isArray: true }) items!: AdminBookingDto[];
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 10 }) pageSize!: number;
  @ApiProperty({ example: 25 }) total!: number;
}
