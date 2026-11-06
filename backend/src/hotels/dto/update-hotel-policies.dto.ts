import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNumber, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { TIME_ONLY } from './transforms';

export class CancellationTierDto {
  @ApiProperty({ example: 7, description: 'Whole days before check-in.' })
  @IsInt() @Min(0)
  daysBeforeCheckIn!: number;

  @ApiProperty({ example: 50 })
  @IsNumber() @Min(0) @Max(100)
  refundPercentage!: number;
}

/** HTL-09, HTL-10. */
export class UpdateHotelPoliciesDto {
  @ApiPropertyOptional({ example: '15:00' })
  @ValidateIf((_object, value) => value !== undefined) @Matches(TIME_ONLY, { message: 'checkInTime must be HH:mm, 00:00-23:59' })
  checkInTime?: string;

  @ApiPropertyOptional({ example: '10:00' })
  @ValidateIf((_object, value) => value !== undefined) @Matches(TIME_ONLY, { message: 'checkOutTime must be HH:mm, 00:00-23:59' })
  checkOutTime?: string;

  @ApiPropertyOptional({ type: [CancellationTierDto] })
  @ValidateIf((_object, value) => value !== undefined) @IsArray() @ArrayMinSize(0) @ValidateNested({ each: true }) @Type(() => CancellationTierDto)
  cancellationTiers?: CancellationTierDto[];
}
