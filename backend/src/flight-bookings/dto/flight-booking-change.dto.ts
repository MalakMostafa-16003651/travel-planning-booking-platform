import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { FlightSegmentDto, FlightRefundStatusDto } from './flight-booking-response.dto';

/** All amounts here are USD minor units; /api/payments uses major units. */
export class FlightBookingChangeDto {
  @ApiProperty() flightBookingChangeId!: string;
  @ApiProperty() flightBookingId!: string;
  @ApiProperty({ enum: BookingStatus, description: 'PENDING is a replacement hold; CONFIRMED means applied. The original booking remains Confirmed until the switch.' }) status!: BookingStatus;
  @ApiProperty({ description: 'Original fare, integer minor units.' }) previousAmount!: number;
  @ApiProperty({ description: 'Replacement fare, integer minor units.' }) totalAmount!: number;
  @ApiProperty({ description: 'Replacement minus original, integer minor units. May be negative.' }) differenceAmount!: number;
  @ApiProperty({ minimum: 0, description: 'Positive difference only, integer minor units.' }) amountToPay!: number;
  @ApiProperty({ minimum: 0, description: 'Lower-fare refund obligation, integer minor units.' }) refundAmount!: number;
  @ApiProperty({ example: 'USD' }) currency!: string;
  @ApiProperty({ type: [FlightSegmentDto] }) segments!: FlightSegmentDto[];
  @ApiProperty({ format: 'date-time', description: '10-minute proposal deadline; historical after application/cancellation.' }) holdExpiresAt!: Date;
  @ApiPropertyOptional({ format: 'date-time' }) appliedAt?: Date;
  @ApiPropertyOptional({ type: FlightRefundStatusDto, description: 'Authoritative lower-fare refund status, scoped to this change; amount in minor units.' }) refund?: FlightRefundStatusDto;
  @ApiProperty({ description: 'True while a fare-decrease refund request is due/retryable. False does not imply Stripe has completed a pending refund.' }) refundDue!: boolean;
}
