import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AirportsService } from './airports.service';
import { AirportResponseDto } from './dto/airport-response.dto';


@ApiTags('Airports')
@Controller('airports')
export class AirportsController {
  constructor(private readonly airports: AirportsService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'List the predefined read-only airport catalog (FLT-02)' })
  @ApiOkResponse({ type: AirportResponseDto, isArray: true, description: 'Airports with IATA code, name, city, country and IANA timezone' })
  async list(): Promise<AirportResponseDto[]> { return (await this.airports.list()).map(AirportResponseDto.from); }
}
