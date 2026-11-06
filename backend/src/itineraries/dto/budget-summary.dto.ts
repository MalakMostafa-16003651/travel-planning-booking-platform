import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransportMode } from '../itinerary.rules';

export class CategoryTotalsDto {
  @ApiProperty() FOOD!: number;
  @ApiProperty() ACCOMMODATION!: number;
  @ApiProperty() ACTIVITIES!: number;
  @ApiProperty() LOCAL_TRANSPORT!: number;
}

export class DayBudgetDto {
  @ApiProperty() dayId!: string;
  @ApiProperty() dayNumber!: number;
  @ApiProperty() date!: string;
  @ApiProperty() city!: string;
  @ApiProperty({ type: CategoryTotalsDto }) categories!: CategoryTotalsDto;
  @ApiProperty({ description: 'Intercity transport assigned to this day, included in total.' }) transport!: number;
  @ApiProperty() total!: number;
}

export class CityBudgetDto {
  @ApiProperty() city!: string;
  @ApiPropertyOptional() countryCode?: string;
  @ApiProperty() firstDayNumber!: number;
  @ApiProperty() lastDayNumber!: number;
  @ApiProperty() total!: number;
}

export class ConvertedTransportCostDto {
  @ApiProperty() transportCostId!: string;
  @ApiProperty() fromCity!: string;
  @ApiProperty() toCity!: string;
  @ApiProperty({ enum: TransportMode }) mode!: TransportMode;
  @ApiProperty({ description: 'Amount as entered.' }) amount!: number;
  @ApiProperty({ description: 'Currency as entered.' }) currency!: string;
  @ApiProperty({ description: 'Amount in the summary currency.' }) convertedAmount!: number;
}

export class OriginalCurrencyTotalDto {
  @ApiProperty() currency!: string;
  @ApiProperty() amount!: number;
}

export class BudgetTotalsDto {
  @ApiProperty({ type: CategoryTotalsDto }) categories!: CategoryTotalsDto;
  @ApiProperty({ description: 'Sum of the four daily categories.' }) daily!: number;
  @ApiProperty({ description: 'Intercity transport costs.' }) transport!: number;
  @ApiProperty() grandTotal!: number;
}

/** ITN-14, ITN-18. Every converted figure is in `currency`, rounded to 2 decimals. */
export class BudgetSummaryDto {
  @ApiProperty() itineraryId!: string;
  @ApiProperty({ example: 'EUR' }) currency!: string;
  @ApiProperty({ type: BudgetTotalsDto }) totals!: BudgetTotalsDto;
  @ApiProperty({ type: [DayBudgetDto] }) byDay!: DayBudgetDto[];
  @ApiProperty({ type: [CityBudgetDto] }) byCity!: CityBudgetDto[];
  @ApiProperty({ type: [ConvertedTransportCostDto] }) transportCosts!: ConvertedTransportCostDto[];
  @ApiProperty({ type: [OriginalCurrencyTotalDto], description: 'Unconverted sums per entered currency.' }) originalTotals!: OriginalCurrencyTotalDto[];
  @ApiPropertyOptional({ nullable: true, description: 'Provider date of the rates used; null when no conversion was needed.' }) rateDate!: string | null;
  @ApiProperty({ description: 'True when the provider failed and the last cached snapshot was used.' }) ratesStale!: boolean;
}
