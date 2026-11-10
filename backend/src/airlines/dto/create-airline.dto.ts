import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateAirlineDto {
  @ApiProperty({ example: 'EgyptAir' })
  @IsString() @MinLength(2) @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'MS', description: '2–8 uppercase letters or digits.' })
  @IsString() @Matches(/^[A-Z0-9]{2,8}$/)
  code!: string;
}
