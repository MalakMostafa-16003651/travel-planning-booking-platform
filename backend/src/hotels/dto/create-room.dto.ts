import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateRoomDto {
  @ApiProperty({ example: 'Deluxe King' })
  @IsString() @MinLength(1) @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 2, description: 'Maximum guests.' })
  @IsInt() @Min(1)
  capacity!: number;

  @ApiProperty({ example: 15000, description: 'Integer minor units. Confirm platform currency with Person 8.' })
  @IsInt() @Min(1)
  pricePerNight!: number;
}
