import { Transform } from 'class-transformer';
const trimmed = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
import { ApiProperty } from '@nestjs/swagger';
import { Max, IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateRoomDto {
  @ApiProperty({ example: 'Deluxe King' })
  @Transform(trimmed) @IsString() @MinLength(1) @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 2, description: 'Maximum guests.' })
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  capacity!: number;

  @ApiProperty({ example: 15000, description: "Integer minor units of PLATFORM_CURRENCY ('USD', PAY-04)." })
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  pricePerNight!: number;

  @ApiProperty({ example: 'Deluxe', maxLength: 80 })
  @Transform(trimmed) @IsString() @MinLength(1) @MaxLength(80)
  type!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER)
  beds!: number;
}
