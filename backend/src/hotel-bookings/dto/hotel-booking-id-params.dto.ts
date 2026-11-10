import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class HotelBookingIdParamsDto {
  @ApiProperty({ description: 'hotelBookingId', pattern: '^[a-fA-F0-9]{24}$', example: '507f1f77bcf86cd799439011' })
  @IsMongoId({ message: 'Hotel booking ID must be a valid ID' })
  id!: string;
}
