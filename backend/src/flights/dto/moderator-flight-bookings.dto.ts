import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { ListFlightBookingsQueryDto } from '../../flight-bookings/dto/list-flight-bookings-query.dto';
import { CabinClass } from '../schemas/cabin-inventory.schema';

export class ModeratorFlightBookingsQueryDto extends PickType(ListFlightBookingsQueryDto, ['page'] as const) {}

export class FlightIdParamsDto {
  @ApiProperty() @IsMongoId() flightId!: string;
}

export class ModeratorFlightBookingDto {
  @ApiProperty() flightBookingId!: string;
  @ApiPropertyOptional() bookingReference?: string;
  @ApiProperty({ type: [String] }) passengerNames!: string[];
  @ApiPropertyOptional({ enum: CabinClass }) cabinClass?: string;
  @ApiProperty() seatCount!: number;
  @ApiProperty({ enum: BookingStatus }) status!: BookingStatus;
}

export class ModeratorFlightBookingsPageDto {
  @ApiProperty({ type: [ModeratorFlightBookingDto] }) items!: ModeratorFlightBookingDto[];
  @ApiProperty() page!: number;
  @ApiProperty({ example: 10 }) pageSize!: number;
  @ApiProperty() total!: number;
}
