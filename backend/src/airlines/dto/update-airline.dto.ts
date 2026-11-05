import { ApiPropertyOptional } from '@nestjs/swagger';
import { ValidateIf, IsString, Matches, MaxLength, MinLength, IsUrl, IsNotEmpty } from 'class-validator';

export class UpdateAirlineDto {
  @ApiPropertyOptional({ example: 'EgyptAir' })
  @ValidateIf((_object, value) => value !== undefined) @IsString() @MinLength(2) @MaxLength(120) @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ example: 'MS' })
  @ValidateIf((_object, value) => value !== undefined) @IsString() @Matches(/^[A-Z0-9]{2,8}$/)
  code?: string;

  @ApiPropertyOptional({ example: 'https://example.com/logo.png' })
  @ValidateIf((_object, value) => value !== undefined) @IsUrl({ require_protocol: true }) @MaxLength(500)
  logo?: string;
}
