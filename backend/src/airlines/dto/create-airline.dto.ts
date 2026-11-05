import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength, IsUrl } from 'class-validator';

export class CreateAirlineDto {
  @ApiProperty({ example: 'EgyptAir' })
  @IsString() @MinLength(2) @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'MS', description: '2–8 uppercase letters or digits.' })
  @IsString() @Matches(/^[A-Z0-9]{2,8}$/)
  code!: string;

  @ApiPropertyOptional({ example: 'https://example.com/logo.png' })
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(500)
  logo?: string;
}
