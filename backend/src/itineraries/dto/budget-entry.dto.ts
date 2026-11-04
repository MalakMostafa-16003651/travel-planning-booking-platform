import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { BudgetCategory, MAX_AMOUNT } from '../itinerary.rules';
import { CURRENCY_CODE, Trim, TrimUpper } from './transforms';

export class CreateBudgetEntryDto {
  @ApiProperty({ enum: BudgetCategory })
  @IsEnum(BudgetCategory, { message: 'Category must be FOOD, ACCOMMODATION, ACTIVITIES or LOCAL_TRANSPORT' })
  category!: BudgetCategory;

  @ApiProperty({ example: 450.5, minimum: 0, description: 'Amount in `currency`, at most two decimal places.' })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 }, { message: 'Amount must be a number with at most two decimal places' })
  @Min(0, { message: 'Amount must not be negative' })
  @Max(MAX_AMOUNT, { message: 'Amount is too large' })
  amount!: number;

  @ApiProperty({ example: 'EGP' })
  @TrimUpper()
  @Matches(CURRENCY_CODE, { message: 'Currency must be a three-letter code' })
  currency!: string;

  @ApiPropertyOptional({ example: 'Dinner on the Nile', maxLength: 500 })
  @IsOptional()
  @Trim()
  @IsString({ message: 'Description must be text' })
  @MaxLength(500, { message: 'Description must be at most 500 characters' })
  description?: string;
}

export class UpdateBudgetEntryDto extends PartialType(CreateBudgetEntryDto) {}
