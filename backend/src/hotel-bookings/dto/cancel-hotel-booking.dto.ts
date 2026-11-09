import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsString, Matches } from 'class-validator';

export class CancelHotelBookingDto {
  @ApiProperty({ example: true, description: 'Explicitly confirm cancellation of the whole reservation.' })
  @Equals(true)
  confirmed!: boolean;

  @ApiProperty({ description: 'Unmodified token returned by the current cancellation quote.' })
  @IsString()
  @Matches(/^\d{13}\.[a-f\d]{64}$/)
  quoteToken!: string;
}

export class HotelCancellationQuoteDto {
  @ApiProperty() hotelBookingId!: string;
  @ApiProperty({ description: 'Full reservation total, minor units.' }) totalPrice!: number;
  @ApiProperty() currency!: string;
  @ApiProperty() daysBeforeCheckIn!: number;
  @ApiProperty() refundPercentage!: number;
  @ApiProperty({ description: 'Refund on the full reservation, minor units.' }) refundAmount!: number;
  @ApiProperty() expiresAt!: Date;
  @ApiProperty({ description: 'Required with confirmed:true when cancelling. Valid for five minutes and the current UTC day/booking snapshot.' }) quoteToken!: string;
}