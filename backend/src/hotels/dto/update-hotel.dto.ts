import { Transform } from 'class-transformer';
const trimmed = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsInt, Max, Min, IsNotEmpty, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class UpdateHotelDto {
  @ApiPropertyOptional({ example: 'Nile Grand Hotel' })
  @ValidateIf((_object, value) => value !== undefined) @Transform(trimmed) @IsString() @MinLength(2) @MaxLength(150) @IsNotEmpty()
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

  @ApiPropertyOptional({ example: 4, minimum: 1, maximum: 5 })
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1) @Max(5)
  starClass?: number;

  @ApiPropertyOptional({ type: [String], example: ['Wi-Fi', 'Pool'], maxItems: 50 })
  @ValidateIf((_object, value) => value !== undefined) @Transform(({value}) => Array.isArray(value) ? value.map(v=>typeof v==='string'?v.trim():v) : value)
  @IsArray() @ArrayMaxSize(50) @ArrayUnique() @IsString({each:true}) @MinLength(1,{each:true}) @MaxLength(100,{each:true})
  amenities?: string[];
}
