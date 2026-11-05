import { ApiPropertyOptional } from '@nestjs/swagger';
import { ValidateIf, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateFlightDto {
  @ApiPropertyOptional({ example: '2026-12-10T15:00' }) @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(19) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/) departureLocalDateTime?: string;
  @ApiPropertyOptional({ example: '2026-12-10T19:00' }) @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(19) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/) arrivalLocalDateTime?: string;
}
