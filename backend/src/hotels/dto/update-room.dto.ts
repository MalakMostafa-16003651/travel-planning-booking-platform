import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export class UpdateRoomDto {
  @ApiPropertyOptional({ example: 'Deluxe King' })
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MinLength(1) @MaxLength(120) @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ example: 3 })
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1)
  capacity?: number;

  @ApiPropertyOptional({ example: 16000 })
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1)
  pricePerNight?: number;
}
