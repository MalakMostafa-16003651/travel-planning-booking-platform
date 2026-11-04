import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { BOOKINGS_PAGE_SIZE } from '../flight-booking.rules';
import { CancelledBy, FlightBooking, FlightSegment, Passenger, PassengerType } from '../schemas/flight-booking.schema';

export class FlightSegmentDto {
  @ApiProperty() flightId!: string;
  @ApiProperty() airlineId!: string;
  @ApiProperty() cabinId!: string;
  @ApiProperty({ example: 'ECONOMY' }) cabinClass!: string;
  @ApiProperty({ description: 'Adult/child fare in minor units.', example: 15000 }) fare!: number;
  @ApiProperty({ example: 'MS801' }) flightNumber!: string;
  @ApiProperty({ example: 'CAI' }) departureAirportCode!: string;
  @ApiProperty({ example: 'DXB' }) arrivalAirportCode!: string;
  @ApiProperty() departureAt!: Date;
  @ApiProperty() arrivalAt!: Date;
  @ApiProperty({ example: 'Africa/Cairo' }) departureTimeZone!: string;
  @ApiProperty({ example: 'Asia/Dubai' }) arrivalTimeZone!: string;

  static from(segment: FlightSegment): FlightSegmentDto {
    return {
      flightId: segment.flightId.toString(),
      airlineId: segment.airlineId.toString(),
      cabinId: segment.cabinId.toString(),
      cabinClass: segment.cabinClass,
      fare: segment.fare,
      flightNumber: segment.flightNumber,
      departureAirportCode: segment.departureAirportCode,
      arrivalAirportCode: segment.arrivalAirportCode,
      departureAt: segment.departureAt,
      arrivalAt: segment.arrivalAt,
      departureTimeZone: segment.departureTimeZone,
      arrivalTimeZone: segment.arrivalTimeZone,
    };
  }
}

export class PassengerSummaryDto {
  @ApiProperty() fullName!: string;
  @ApiProperty({ enum: PassengerType }) type!: PassengerType;
  @ApiProperty() extraBags!: number;
  @ApiProperty() extraBaggageWeightKg!: number;
}

/** FLT-21: what the user reviews before proceeding to payment. */
export class FlightBookingSummaryDto {
  @ApiProperty({ type: [FlightSegmentDto] }) segments!: FlightSegmentDto[];
  @ApiProperty({ type: [PassengerSummaryDto] }) passengers!: PassengerSummaryDto[];
  @ApiProperty({ description: 'Adults and children; infants occupy no seat.' }) seatCount!: number;
  @ApiProperty({ description: 'Minor units.' }) baggageFee!: number;
  @ApiProperty({ description: 'Minor units, including baggage.' }) totalAmount!: number;
  @ApiProperty({ example: 'USD' }) currency!: string;
}

export class PassengerDetailsDto extends PassengerSummaryDto {
  @ApiProperty() passengerId!: string;
  @ApiProperty() dateOfBirth!: Date;
  @ApiProperty() documentNumber!: string;

  static from(passenger: Passenger): PassengerDetailsDto {
    return {
      passengerId: passenger._id.toString(),
      fullName: passenger.fullName,
      dateOfBirth: passenger.dateOfBirth,
      documentNumber: passenger.documentNumber,
      type: passenger.type,
      extraBags: passenger.extraBags,
      extraBaggageWeightKg: passenger.extraBaggageWeightKg,
    };
  }
}

export class FlightBookingDto {
  @ApiProperty() flightBookingId!: string;
  @ApiProperty() userId!: string;
  @ApiProperty({ enum: BookingStatus }) status!: BookingStatus;
  @ApiPropertyOptional({ description: 'Generated on confirmation.' }) bookingReference?: string;
  @ApiProperty({ type: [FlightSegmentDto] }) segments!: FlightSegmentDto[];
  @ApiProperty({ type: [PassengerDetailsDto] }) passengers!: PassengerDetailsDto[];
  @ApiProperty() seatCount!: number;
  @ApiProperty() baggageFee!: number;
  @ApiProperty() totalAmount!: number;
  @ApiProperty() currency!: string;
  @ApiPropertyOptional({ description: 'When the seat hold ends, for PENDING bookings.' }) holdExpiresAt?: Date;
  @ApiPropertyOptional() paymentId?: string;
  @ApiPropertyOptional() refundId?: string;
  @ApiPropertyOptional() refundAmount?: number;
  @ApiPropertyOptional() cancelledAt?: Date;
  @ApiPropertyOptional({ enum: CancelledBy }) cancelledBy?: CancelledBy;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static from(booking: FlightBooking): FlightBookingDto {
    return {
      flightBookingId: booking._id.toString(),
      userId: booking.userId.toString(),
      status: booking.status,
      bookingReference: booking.bookingReference,
      segments: booking.segments.map(FlightSegmentDto.from),
      passengers: booking.passengers.map(PassengerDetailsDto.from),
      seatCount: booking.seatCount,
      baggageFee: booking.baggageFee,
      totalAmount: booking.totalAmount,
      currency: booking.currency,
      holdExpiresAt: booking.holdExpiresAt,
      paymentId: booking.paymentId?.toString(),
      refundId: booking.refundId?.toString(),
      refundAmount: booking.refundAmount,
      cancelledAt: booking.cancelledAt,
      cancelledBy: booking.cancelledBy,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
    };
  }
}

export class FlightBookingPageDto {
  @ApiProperty({ type: [FlightBookingDto] }) items!: FlightBookingDto[];
  @ApiProperty() page!: number;
  @ApiProperty({ example: BOOKINGS_PAGE_SIZE }) pageSize!: number;
  @ApiProperty() total!: number;
}

/** FLT-26: shown before the user confirms a cancellation. */
export class CancellationQuoteDto {
  @ApiProperty() flightBookingId!: string;
  @ApiProperty({ description: 'Whole days until the outbound departure.' }) daysBeforeDeparture!: number;
  @ApiProperty({ example: 50 }) refundPercentage!: number;
  @ApiProperty({ description: 'Minor units.' }) refundAmount!: number;
  @ApiProperty() totalAmount!: number;
  @ApiProperty() currency!: string;
}
