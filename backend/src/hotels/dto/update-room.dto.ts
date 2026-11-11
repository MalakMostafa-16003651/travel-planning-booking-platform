import { Transform } from 'class-transformer';
const trimmed = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Max, IsInt, IsNotEmpty, IsString, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export class UpdateRoomDto {
  @ApiPropertyOptional({ example: 'Deluxe King' })
  @ValidateIf((_object, value) => value !== undefined) @Transform(trimmed) @IsString() @MinLength(1) @MaxLength(120) @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ example: 3 })
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  capacity?: number;

  @ApiPropertyOptional({ example: 16000 })
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  pricePerNight?: number;

  @ApiPropertyOptional({ example: 'Deluxe', maxLength: 80 })
  @ValidateIf((_object, value) => value !== undefined) @Transform(trimmed) @IsString() @MinLength(1) @MaxLength(80)
  type?: string;

  @ApiPropertyOptional({ example: 2, minimum: 1 })
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  beds?: number;
}
