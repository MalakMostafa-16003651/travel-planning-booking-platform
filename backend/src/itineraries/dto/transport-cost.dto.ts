import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsNumber, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { MAX_AMOUNT, TransportMode } from '../itinerary.rules';
import { CURRENCY_CODE, Trim, TrimUpper } from './transforms';

export class CreateTransportCostDto {
  @ApiProperty({ example: 'Cairo' })
  @Trim()
  @IsString({ message: 'fromCity must be text' })
  @Length(1, 100, { message: 'fromCity must be 1 to 100 characters' })
  fromCity!: string;

  @ApiProperty({ example: 'Luxor' })
  @Trim()
  @IsString({ message: 'toCity must be text' })
  @Length(1, 100, { message: 'toCity must be 1 to 100 characters' })
  toCity!: string;

  @ApiProperty({ enum: TransportMode })
  @IsEnum(TransportMode, { message: 'Mode must be FLIGHT, TRAIN, BUS, CAR, FERRY or OTHER' })
  mode!: TransportMode;

  @ApiProperty({ example: 1200, minimum: 0 })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 }, { message: 'Amount must be a number with at most two decimal places' })
  @Min(0, { message: 'Amount must not be negative' })
  @Max(MAX_AMOUNT, { message: 'Amount is too large' })
  amount!: number;

  @ApiProperty({ example: 'EGP' })
  @TrimUpper()
  @Matches(CURRENCY_CODE, { message: 'Currency must be a three-letter code' })
  currency!: string;

  @ApiProperty({ description: 'Required travel day of this itinerary.' })
  @IsMongoId({ message: 'dayId must be a valid id' })
  dayId!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Trim()
  @IsString({ message: 'Notes must be text' })
  @MaxLength(500, { message: 'Notes must be at most 500 characters' })
  notes?: string;
}

export class UpdateTransportCostDto extends PartialType(CreateTransportCostDto, { skipNullProperties: false }) {}
