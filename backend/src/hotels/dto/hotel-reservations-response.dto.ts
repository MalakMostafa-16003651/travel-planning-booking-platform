import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '../../common/enums/booking-status.enum';
export class HotelReservationRoomDto {
  @ApiProperty() roomId!: string;
  @ApiProperty() roomName!: string;
  @ApiProperty() adults!: number;
  @ApiProperty({ type: [Number] }) childrenAges!: number[];
}
export class HotelReservationSummaryDto {
  @ApiProperty() hotelBookingId!: string;
  @ApiPropertyOptional() bookingReference?: string;
  @ApiProperty() userId!: string;
  @ApiPropertyOptional() guestName?: string;
  @ApiProperty({ type: [HotelReservationRoomDto] }) rooms!: HotelReservationRoomDto[];
  @ApiProperty() checkIn!: string;
  @ApiProperty() checkOut!: string;
  @ApiProperty() guestCount!: number;
  @ApiProperty({ enum: BookingStatus, description: 'PENDING means pending payment: an unexpired hold not yet paid for.' }) status!: BookingStatus;
  @ApiProperty({ description: 'Frozen reservation total in integer minor units.' }) totalAmount!: number;
  @ApiProperty() currency!: string;
}
export class HotelReservationsPageDto {
  @ApiProperty({ type: [HotelReservationSummaryDto] }) items!: HotelReservationSummaryDto[];
  @ApiProperty() page!: number;
  @ApiProperty({ example: 10 }) pageSize!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}
