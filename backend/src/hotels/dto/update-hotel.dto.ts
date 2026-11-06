import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class UpdateHotelDto {
  @ApiPropertyOptional({ example: 'Nile Grand Hotel' })
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MinLength(2) @MaxLength(150) @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ example: 'Cairo' })
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MinLength(1) @MaxLength(100) @IsNotEmpty()
  city?: string;

  @ApiPropertyOptional({ example: 'EG' })
  @ValidateIf((_object, value) => value !== undefined) @IsString() @Matches(/^[A-Z]{2}$/)
  countryCode?: string;

  @ApiPropertyOptional({ example: '12 Nile Corniche, Cairo' })
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MinLength(2) @MaxLength(300) @IsNotEmpty()
  address?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(2000)
  description?: string;
}
