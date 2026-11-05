import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, ValidateIf, Min } from 'class-validator';

export class UpdateCabinDto {
  @ApiPropertyOptional({ example: 130 }) @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1) totalSeats?: number;
  @ApiPropertyOptional({ example: 129000 }) @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1) price?: number;
  @ApiPropertyOptional({ example: 2 }) @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(0) baggageAllowanceCount?: number;
  @ApiPropertyOptional({ example: 25 }) @ValidateIf((_object, value) => value !== undefined) @IsNumber() @Min(0.1) baggageMaxWeightKg?: number;
}
