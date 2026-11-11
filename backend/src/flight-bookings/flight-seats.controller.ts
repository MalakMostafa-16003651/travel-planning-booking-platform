import { Body, Controller, Get, Header, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthenticatedRequest, AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../common/enums/user-role.enum';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { FlightSeatMapDto, SelectFlightSeatsDto } from './dto/select-flight-seats.dto';
import { FlightSeatsService } from './flight-seats.service';

@ApiTags('Flight seats')
@ApiCookieAuth('accessToken')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@ApiNotFoundResponse({ type: ApiErrorDto })
@ApiConflictResponse({ type: ApiErrorDto })
@Controller('flight-bookings/:id')
export class FlightSeatsController {
  constructor(private readonly seats: FlightSeatsService) {}
  @Get('seat-map') @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'FLT-28: view cabin seats for your held/confirmed booking' })
  @ApiOkResponse({ type: FlightSeatMapDto })
  map(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<FlightSeatMapDto> {
    return this.seats.map(id, request.user!.userId);
  }
  @Put('seats') @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'FLT-28: replace seat selections on your future flight segments', description: 'Free optional selection for adults/children. Atomic for the whole request. An empty selections array clears future selections; past-segment history is retained.' })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiOkResponse({ type: FlightSeatMapDto })
  select(@Param('id') id: string, @Body() input: SelectFlightSeatsDto, @Req() request: AuthenticatedRequest): Promise<FlightSeatMapDto> {
    return this.seats.select(id, request.user!.userId, input);
  }
}
