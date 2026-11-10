import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsISO8601, IsMongoId, Matches, Max, Min, ValidateNested } from 'class-validator';

/** Safety bounds on request size only; the workbook sets no limit. */
export const MAX_ROOMS_PER_BOOKING = 10;
const MAX_GUESTS_PER_FIELD = 20;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** HTL-16: one selected room and the guests assigned to it. */
export class HotelBookingRoomRequestDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439012' })
  @IsMongoId({ message: 'roomId must be a valid ID' })
  roomId!: string;

  @ApiProperty({ example: 2, minimum: 0, description: 'At least one adult is required across the reservation.' })
  @IsInt({ message: 'Adults must be a whole number' })
  @Min(0, { message: 'Adults cannot be negative' })
  @Max(MAX_GUESTS_PER_FIELD, { message: `Adults must be at most ${MAX_GUESTS_PER_FIELD}` })
  adults!: number;

  @ApiProperty({ type: [Number], example: [7], description: 'One age per child, 0-17. Children count towards the room\'s maximum occupancy.' })
  @IsArray({ message: 'Children ages must be a list' })
  @ArrayMaxSize(MAX_GUESTS_PER_FIELD, { message: `At most ${MAX_GUESTS_PER_FIELD} children per room` })
  @IsInt({ each: true, message: 'Each child age must be a whole number' })
  @Min(0, { each: true, message: 'Child ages must be between 0 and 17' })
  @Max(17, { each: true, message: 'Child ages must be between 0 and 17' })
  childrenAges!: number[];
}

/** HTL-16/HTL-18: one or more rooms of the same hotel for the same dates, held together. */
export class CreateHotelBookingDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @IsMongoId({ message: 'hotelId must be a valid ID' })
  hotelId!: string;

  @ApiProperty({ example: '2026-12-20', format: 'date', description: 'UTC calendar date, not before today.' })
  @Matches(DATE_ONLY, { message: 'Check-in must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'Check-in must be a valid date' })
  checkIn!: string;

  @ApiProperty({ example: '2026-12-23', format: 'date', description: 'After check-in. The stay is [checkIn, checkOut).' })
  @Matches(DATE_ONLY, { message: 'Check-out must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'Check-out must be a valid date' })
  checkOut!: string;

  @ApiProperty({ type: [HotelBookingRoomRequestDto], description: `1 to ${MAX_ROOMS_PER_BOOKING} distinct rooms of this hotel.` })
  @IsArray({ message: 'Rooms must be a list' })
  @ArrayMinSize(1, { message: 'Select at least one room' })
  @ArrayMaxSize(MAX_ROOMS_PER_BOOKING, { message: `Select at most ${MAX_ROOMS_PER_BOOKING} rooms` })
  @ValidateNested({ each: true })
  @Type(() => HotelBookingRoomRequestDto)
  rooms!: HotelBookingRoomRequestDto[];
}
