import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '../schemas/currency.schema';

export class CurrencyDto {
  @ApiProperty({ example: 'EGP', pattern: '^[A-Z]{3}$', minLength: 3, maxLength: 3 })
  code!: string;

  @ApiProperty({ example: 'Egyptian pound' })
  name!: string;

  static fromCurrency(currency: Currency): CurrencyDto {
    return { code: currency.code, name: currency.name };
  }
}
