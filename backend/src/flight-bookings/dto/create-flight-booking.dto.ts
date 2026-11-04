import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsISO8601, IsInt, IsMongoId, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { PassengerType } from '../schemas/flight-booking.schema';

const trimmed = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class FlightSelectionDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @IsMongoId({ message: 'flightId must be a valid ID' })
  flightId!: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439012' })
  @IsMongoId({ message: 'cabinId must be a valid ID' })
  cabinId!: string;
}

export class PassengerDto {
  @ApiProperty({ example: 'Alex Traveler' })
  @Transform(trimmed)
  @IsString({ message: 'Full name must be a string' })
  @IsNotEmpty({ message: 'Full name is required' })
  @MaxLength(100, { message: 'Full name must contain at most 100 characters' })
  fullName!: string;

  @ApiProperty({ example: '1995-04-12', format: 'date' })
  @IsISO8601({ strict: true }, { message: 'Date of birth must be a valid date' })
  dateOfBirth!: string;

  @ApiProperty({ example: 'A12345678', description: 'Passport or national ID number.' })
  @Transform(trimmed)
  @IsString({ message: 'Passport/ID number must be a string' })
  @Matches(/^[A-Za-z0-9-]{5,20}$/, { message: 'Passport/ID number must be 5 to 20 letters, digits or hyphens' })
  documentNumber!: string;

  @ApiProperty({ enum: PassengerType, description: 'Checked against the date of birth: adult 12+, child 2-11, infant under 2 (FLT-12).' })
  @IsEnum(PassengerType, { message: 'Passenger type must be ADULT, CHILD or INFANT' })
  type!: PassengerType;

  @ApiPropertyOptional({ example: 1, description: 'Extra bags, up to the airline maximum (FLT-19).' })
  @IsOptional()
  @IsInt({ message: 'Extra bags must be a whole number' })
  @Min(0, { message: 'Extra bags cannot be negative' })
  extraBags?: number;

  @ApiPropertyOptional({ example: 20, description: 'Combined weight in kg of the extra bags. Required when extraBags is above 0.' })
  @IsOptional()
  @IsNumber({}, { message: 'Extra baggage weight must be a number' })
  @IsPositive({ message: 'Extra baggage weight must be positive' })
  extraBaggageWeightKg?: number;
}

export class CreateFlightBookingDto {
  @ApiProperty({ type: [FlightSelectionDto], description: 'One entry for one-way; outbound then return for a round trip.' })
  @IsArray({ message: 'Segments must be a list' })
  @ArrayMinSize(1, { message: 'Select at least one flight' })
  @ArrayMaxSize(2, { message: 'A booking has at most two segments' })
  @ValidateNested({ each: true })
  @Type(() => FlightSelectionDto)
  segments!: FlightSelectionDto[];

  @ApiProperty({ type: [PassengerDto] })
  @IsArray({ message: 'Passengers must be a list' })
  @ArrayMinSize(1, { message: 'Add at least one passenger' })
  @ArrayMaxSize(50, { message: 'A booking has at most 50 passengers' })
  @ValidateNested({ each: true })
  @Type(() => PassengerDto)
  passengers!: PassengerDto[];
}
