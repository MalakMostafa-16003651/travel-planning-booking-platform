import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNumber, ValidateIf, Max, Min, ValidateNested } from 'class-validator';

export class BaggagePolicyDto {
  @ApiProperty({ example: 2500, description: 'Integer minor currency units; confirm platform currency with Person 8.' })
  @IsInt() @Min(1)
  pricePerExtraBag!: number;

  @ApiProperty({ example: 2 })
  @IsInt() @Min(0)
  maxExtraBagsPerPassenger!: number;
}

export class CancellationTierDto {
  @ApiProperty({ example: 14 })
  @IsInt() @Min(0)
  daysBeforeDeparture!: number;

  @ApiProperty({ example: 75 })
  @IsNumber() @Min(0) @Max(100)
  refundPercentage!: number;
}

export class UpdateAirlinePoliciesDto {
  @ApiPropertyOptional({ type: BaggagePolicyDto })
  @ValidateIf((_object, value) => value !== undefined) @ValidateNested() @Type(() => BaggagePolicyDto)
  baggagePolicy?: BaggagePolicyDto;

  @ApiPropertyOptional({ type: [CancellationTierDto] })
  @ValidateIf((_object, value) => value !== undefined) @IsArray() @ValidateNested({ each: true }) @Type(() => CancellationTierDto)
  cancellationTiers?: CancellationTierDto[];
}
