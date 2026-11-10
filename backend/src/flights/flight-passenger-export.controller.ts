import { Controller, Get, Header, Req, StreamableFile, UseGuards } from '@nestjs/common';
import {ApiCookieAuth,ApiForbiddenResponse,ApiNotFoundResponse,ApiOkResponse,ApiOperation,ApiProduces,ApiTags,ApiUnauthorizedResponse} from '@nestjs/swagger';
import { Param } from '@nestjs/common';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { FlightPassengerExportService } from './flight-passenger-export.service';

@ApiTags('Flights')
@ApiCookieAuth('accessToken')
@ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'A valid session is required.' })
@ApiForbiddenResponse({ type: ApiErrorDto, description: 'Airline moderator role with one assigned airline is required.' })
@ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such flight in your airline.' })
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.AIRLINE_MODERATOR)
@Controller('flights')
export class FlightPassengerExportController {
  constructor(private readonly exports: FlightPassengerExportService) {}

  // FLT-29: the passenger list of one flight of the moderator's own airline, as a CSV file.
  @Get(':flightId/bookings/export.csv')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Export the passenger list of your flight as CSV (FLT-29)',
    description: 'Booking reference, passenger names, cabin, seats and status for every booking of the flight. Passport numbers and birth dates are never included.',
  })
  @ApiProduces('text/csv')
  @ApiOkResponse({ description: 'CSV file', schema: { type: 'string', format: 'binary' } })
  async exportCsv(@Req() req: AuthenticatedRequest, @Param('flightId') flightId: string): Promise<StreamableFile> {
    const { fileName, csv } = await this.exports.exportCsv(req.user!.userId, flightId);
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${fileName}"`,
    });
  }
}
