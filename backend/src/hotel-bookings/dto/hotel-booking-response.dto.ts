import { RefundStatus } from '../../payments/payment-status.enum';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { HOTEL_BOOKINGS_PAGE_SIZE } from '../hotel-booking.constants';
import { HotelBooking, HotelBookingCancelledBy, HotelBookingRoom } from '../schemas/hotel-booking.schema';

export class HotelBookingRoomDto {
  @ApiProperty() roomId!: string;
  @ApiProperty({ example: 'Deluxe King 204' }) roomName!: string;
  @ApiProperty({ description: 'Price per night at booking time, minor units.', example: 12500 }) pricePerNight!: number;
  @ApiProperty({ example: 2 }) adults!: number;
  @ApiProperty({ type: [Number], description: 'Ages 0-17.', example: [7] }) childrenAges!: number[];
  @ApiProperty({ description: 'nights x pricePerNight, minor units.', example: 37500 }) subtotal!: number;

  static from(room: HotelBookingRoom): HotelBookingRoomDto {
    return {
      roomId: room.roomId.toString(),
      roomName: room.roomName,
      pricePerNight: room.pricePerNight,
      adults: room.adults,
      childrenAges: [...room.childrenAges],
      subtotal: room.subtotal,
    };
  }
}

export class CancellationTierDto {
  @ApiProperty({ example: 7 }) daysBeforeCheckIn!: number;
  @ApiProperty({ example: 50 }) refundPercentage!: number;
}

export class HotelPolicySnapshotDto {
  @ApiProperty({ type: [CancellationTierDto] }) cancellationTiers!: CancellationTierDto[];
  @ApiProperty({ example: '14:00' }) checkInTime!: string;
  @ApiProperty({ example: '11:00' }) checkOutTime!: string;
}

/** HTL-20: one reservation with reference, hotel, rooms, dates, guests, total and status. */
export class HotelBookingDto {
  @ApiProperty() hotelBookingId!: string;
  @ApiProperty() userId!: string;
  @ApiProperty() hotelId!: string;
  @ApiProperty({ example: 'Nile View Hotel' }) hotelName!: string;
  @ApiProperty({ enum: BookingStatus }) status!: BookingStatus;
  @ApiPropertyOptional({ description: 'Generated on confirmation (HTL-17).', example: 'H7K2M9QX' }) bookingReference?: string;
  @ApiProperty({ type: [HotelBookingRoomDto] }) rooms!: HotelBookingRoomDto[];
  @ApiProperty({ example: '2026-12-20' }) checkIn!: string;
  @ApiProperty({ description: 'Check-out date; the stay is [checkIn, checkOut).', example: '2026-12-23' }) checkOut!: string;
  @ApiProperty({ example: 3 }) nights!: number;
  @ApiProperty({ description: 'Adults and children across all rooms.', example: 3 }) guestCount!: number;
  @ApiProperty({ description: 'Minor units.', example: 37500 }) totalPrice!: number;
  @ApiProperty({ example: 'USD' }) currency!: string;
  @ApiProperty({ type: HotelPolicySnapshotDto, description: 'Policy shown before payment (PAY-02, HTL-09).' }) policy!: HotelPolicySnapshotDto;
  @ApiPropertyOptional({ description: 'Set while PENDING.' }) holdExpiresAt?: Date;
  @ApiPropertyOptional() paymentId?: string;
  @ApiPropertyOptional() cancelledAt?: Date;
  @ApiPropertyOptional({ enum: HotelBookingCancelledBy }) cancelledBy?: HotelBookingCancelledBy;
  @ApiPropertyOptional({ description: 'Minor units.' }) refundAmount?: number;
  @ApiPropertyOptional() refundId?: string;
  @ApiPropertyOptional({ enum: RefundStatus, description: 'Current refund status on the reservation detail/cancellation response.' }) refundStatus?: RefundStatus;
  @ApiPropertyOptional() completedAt?: Date;
  @ApiProperty() createdAt!: Date;

  static from(booking: HotelBooking): HotelBookingDto {
    return {
      hotelBookingId: booking._id.toString(),
      userId: booking.userId.toString(),
      hotelId: booking.hotelId.toString(),
      hotelName: booking.hotelName,
      status: booking.status,
      bookingReference: booking.bookingReference,
      rooms: booking.rooms.map(HotelBookingRoomDto.from),
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      nights: booking.nights,
      guestCount: booking.rooms.reduce((sum, room) => sum + room.adults + room.childrenAges.length, 0),
      totalPrice: booking.totalPrice,
      currency: booking.currency,
      policy: {
        cancellationTiers: booking.policySnapshot.cancellationTiers.map(({ daysBeforeCheckIn, refundPercentage }) => ({ daysBeforeCheckIn, refundPercentage })),
        checkInTime: booking.policySnapshot.checkInTime,
        checkOutTime: booking.policySnapshot.checkOutTime,
      },
      holdExpiresAt: booking.holdExpiresAt,
      paymentId: booking.paymentId?.toString(),
      cancelledAt: booking.cancelledAt,
      cancelledBy: booking.cancelledBy,
      refundAmount: booking.refundAmount,
      refundId: booking.refundId?.toString(),
      completedAt: booking.completedAt,
      createdAt: booking.createdAt,
    };
  }
}

export class HotelBookingPageDto {
  @ApiProperty({ type: [HotelBookingDto] }) items!: HotelBookingDto[];
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: HOTEL_BOOKINGS_PAGE_SIZE }) pageSize!: number;
  @ApiProperty({ example: 1 }) total!: number;
}
