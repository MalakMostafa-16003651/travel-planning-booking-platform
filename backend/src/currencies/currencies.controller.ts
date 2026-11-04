import { Controller, Get, Header } from '@nestjs/common';
import { ApiInternalServerErrorResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { CurrenciesService } from './currencies.service';
import { CurrencyDto } from './dto/currency.dto';

@ApiTags('Currencies')
@Controller('currencies')
export class CurrenciesController {
  constructor(private readonly currencies: CurrenciesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List shared supported currencies',
    description: 'Returns the shared currency catalog ordered by code for profile preferences (ACC-09) and itinerary budgets (ITN-18).',
  })
  @ApiOkResponse({ type: CurrencyDto, isArray: true })
  @ApiInternalServerErrorResponse({ type: ApiErrorDto, description: 'The currency catalog could not be read.' })
  async list(): Promise<CurrencyDto[]> {
    return (await this.currencies.listSupported()).map(CurrencyDto.fromCurrency);
  }
}
