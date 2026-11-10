import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, Matches, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { PROVIDER_TYPES, ProviderType } from '../../admin/dto/provider-params.dto';
export class AnalyticsQueryDto {
  @ApiProperty({ example: '2026-11-01', description: 'First confirmation date, inclusive, UTC.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  from!: string;

  @ApiProperty({ example: '2026-11-20', description: 'Last confirmation date, inclusive, UTC. Maximum 366 days.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  to!: string;

  @ApiPropertyOptional({ enum: PROVIDER_TYPES })
  @IsOptional() @IsIn(PROVIDER_TYPES)
  type?: ProviderType;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000)
  page?: number;
}

export class ProviderAnalyticsDto {
  @ApiProperty({ enum: PROVIDER_TYPES }) type!: ProviderType;
  @ApiPropertyOptional() airlineId?: string;
  @ApiPropertyOptional() hotelId?: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Successfully paid bookings involving this provider. A mixed-airline booking counts once for each participating airline.' }) bookings!: number;
  @ApiProperty({ description: 'Allocated receipts, USD cents; not a provider payout ledger.' }) grossRevenueMinor!: number;
  @ApiProperty({ description: 'Completed refunds against those receipts, USD cents, as of generatedAt.' }) refundedMinor!: number;
  @ApiProperty() netRevenueMinor!: number;
  @ApiProperty({ example: 'USD' }) currency!: string;
}
export class AnalyticsPageDto {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty() generatedAt!: Date;
  @ApiProperty({ description: 'Confirmation-date cohort; completed refunds for that cohort are included through generatedAt. Flight receipts use stored segment fare weights; refunds use allocated gross weights, with deterministic cent rounding. Equal weights apply if all fares are zero. Counts across airlines are not additive.' }) basis!: string;
  @ApiProperty({ type: [ProviderAnalyticsDto] }) items!: ProviderAnalyticsDto[];
  @ApiProperty() page!: number;
  @ApiProperty({ example: 10 }) pageSize!: number;
  @ApiProperty() total!: number;
}
