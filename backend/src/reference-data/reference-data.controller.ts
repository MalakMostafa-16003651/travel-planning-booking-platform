import { Controller, Get, Header } from '@nestjs/common';
import { ApiInternalServerErrorResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { ReferenceDataService } from './reference-data.service';

class CountryDto {
  @ApiProperty({ example: 'EG' }) code!: string;
  @ApiProperty({ example: 'Egypt' }) name!: string;
  @ApiProperty({ example: 'EGP' }) currency!: string;
}
class CityDto {
  @ApiProperty({ example: 'new_york' }) cityId!: string;
  @ApiProperty({ example: 'New York' }) name!: string;
  @ApiProperty({ example: 'US' }) countryCode!: string;
}

@ApiTags('Reference data')
@Controller()
export class ReferenceDataController {
  constructor(private readonly references: ReferenceDataService) {}

  @Get('countries')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'GEN-12: list official supported countries' })
  @ApiOkResponse({ type: CountryDto, isArray: true })
  @ApiInternalServerErrorResponse({ type: ApiErrorDto })
  async countries(): Promise<CountryDto[]> {
    return (await this.references.listCountries()).map(({ code, name, currency }) => ({ code, name, currency }));
  }

  @Get('cities')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'GEN-12: list official supported cities' })
  @ApiOkResponse({ type: CityDto, isArray: true })
  @ApiInternalServerErrorResponse({ type: ApiErrorDto })
  async cities(): Promise<CityDto[]> {
    return (await this.references.listCities()).map(({ cityId, name, countryCode }) => ({ cityId, name, countryCode }));
  }
}
