import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BOOKING_TYPES } from '../booking-ref';
import { PaymentStatus, RefundStatus } from '../payment-status.enum';

// Swagger documentation only: the routes return the stored Payment and Refund documents.
// Unlike booking prices (integer cents), these amounts are major units (dollars), as PAY-04 notes.

export class PaymentResponseDto {
  @ApiProperty({ example: '665f1c2b9d3e4a0012345678' })
  _id!: string;

  @ApiProperty({ example: '665f1c2b9d3e4a0012345601' })
  userId!: string;

  @ApiProperty({ enum: BOOKING_TYPES, example: 'flight' })
  bookingType!: string;

  @ApiPropertyOptional({ description: 'Set when bookingType is flight.' })
  flightBookingId?: string;

  @ApiPropertyOptional({ description: 'Set when bookingType is hotel.' })
  hotelBookingId?: string;

  @ApiPropertyOptional({ description: 'Set when bookingType is flight-change.' })
  flightBookingChangeId?: string;

  @ApiProperty({ example: 150.5, description: 'Major units (dollars), not cents. Stripe is charged amount x 100.' })
  amount!: number;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.SUCCEEDED })
  status!: PaymentStatus;

  @ApiProperty({ example: 'pi_3Q...' })
  stripePaymentIntentId!: string;

  @ApiPropertyOptional({ example: 'Your card was declined.' })
  failureReason?: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class RefundResponseDto {
  @ApiProperty({ example: '665f1c2b9d3e4a0012345699' })
  _id!: string;

  @ApiProperty({ example: '665f1c2b9d3e4a0012345601' })
  userId!: string;

  @ApiProperty({ example: '665f1c2b9d3e4a0012345678' })
  paymentId!: string;

  @ApiProperty({ enum: BOOKING_TYPES, example: 'flight' })
  bookingType!: string;

  @ApiPropertyOptional()
  flightBookingId?: string;

  @ApiPropertyOptional()
  hotelBookingId?: string;

  @ApiPropertyOptional()
  flightBookingChangeId?: string;

  @ApiProperty({ example: 120, description: 'Major units (dollars), not cents.' })
  amount!: number;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ enum: RefundStatus, example: RefundStatus.REFUNDED })
  status!: RefundStatus;

  @ApiProperty({ example: 're_3Q...' })
  stripeRefundId!: string;

  @ApiProperty({ example: 'pi_3Q...' })
  stripePaymentIntentId!: string;

  @ApiPropertyOptional({ example: 'Booking cancelled by user' })
  reason?: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
