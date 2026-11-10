import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateHotelDto {
  @ApiProperty({ example: 'Nile Grand Hotel' })
  @IsString() @MinLength(2) @MaxLength(150)
  name!: string;

  @ApiProperty({ example: 'Cairo', description: 'Resolved against the official reference city/country catalog.' })
  @IsString() @MinLength(1) @MaxLength(100)
  city!: string;

  @ApiPropertyOptional({ example: 'EG', description: 'Disambiguates the city when more than one match exists.' })
  @IsOptional() @IsString() @Matches(/^[A-Z]{2}$/)
  countryCode?: string;

  @ApiProperty({ example: '12 Nile Corniche, Cairo' })
  @IsString() @MinLength(2) @MaxLength(300)
  address!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;
}
