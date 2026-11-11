import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {IsISO8601,ArrayMaxSize,ArrayNotEmpty,IsArray,IsBoolean,IsEnum,IsInt,IsOptional,IsString,Matches, Max,Min,Validate,ValidationArguments,ValidatorConstraint,ValidatorConstraintInterface,} from 'class-validator';
import { CabinClass } from '../schemas/cabin-inventory.schema';

export enum FlightSort {
  PRICE = 'price',
  DURATION = 'duration',
  DEPARTURE_TIME = 'departureTime',
}

@ValidatorConstraint({ name: 'passengerCounts', async: false })
class PassengerCountsConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const dto = args.object as FlightSearchDto;

    return (
      dto.adults >= 1 &&
      dto.adults + dto.children + dto.infants <= 50 &&
      dto.infants <= dto.adults
    );
  }

  defaultMessage(): string {
    return 'A search requires at least one adult, at most 50 passengers in total, and no more infants than adults';
  }
}

@ValidatorConstraint({ name: 'returnDateRequired', async: false })
class ReturnDateRequiredConstraint
  implements ValidatorConstraintInterface
{
  validate(_: unknown, args: ValidationArguments): boolean {
    const dto = args.object as FlightSearchDto;

    if (!dto.roundTrip) return true;

    return (
      typeof dto.returnDate === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(dto.returnDate) &&
      // Same-day round trips are allowed; the service keeps only return flights that leave after an outbound lands.
      dto.returnDate >= dto.departureDate
    );
  }

  defaultMessage(): string {
    return 'A round-trip search requires a real return date on or after the departure date';
  }
}


export class FlightSearchDto {
  @ApiProperty({ example: 'CAI' })
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  departureAirportCode!: string;

@ApiProperty({ example: 'DXB' })
@IsString()
@Matches(/^[A-Z]{3}$/)
arrivalAirportCode!: string;

  @ApiProperty({ example: false })
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  @Validate(ReturnDateRequiredConstraint)
  roundTrip!: boolean;

  @ApiProperty({ example: '2026-12-10', description: 'Local date at the departure airport.' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true }, { message: 'departureDate must be a real calendar date' })
  departureDate!: string;

  @ApiPropertyOptional({ example: '2026-12-17' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true }, { message: 'returnDate must be a real calendar date' })
  returnDate?: string;

  @ApiProperty({ example: 1, minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  @Validate(PassengerCountsConstraint)
  adults!: number;

  @ApiProperty({ example: 0, minimum: 0, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  children!: number;

  @ApiProperty({ example: 0, minimum: 0, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  infants!: number;

  @ApiPropertyOptional({ enum: CabinClass })
  @IsOptional()
  @IsEnum(CabinClass)
  cabinClass?: CabinClass;

  @ApiPropertyOptional({
  example: 1,
  minimum: 1,
  description: 'Page number, 10 results per page (GEN-05).',
})
@IsOptional()
@Type(() => Number)
@IsInt()
@Min(1)
page?: number;

  @ApiPropertyOptional({ example: 50000, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ example: 200000, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ enum: FlightSort })
  @IsOptional()
  @IsEnum(FlightSort)
  sortBy?: FlightSort;
}
export class RoundTripSearchDto extends FlightSearchDto {
  @ApiProperty({ example: '2026-12-17' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  declare returnDate: string;
}