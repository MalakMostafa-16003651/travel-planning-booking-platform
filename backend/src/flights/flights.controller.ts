import { Header } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { FlightIdParamsDto, ModeratorFlightBookingsQueryDto, ModeratorFlightBookingsPageDto } from './dto/moderator-flight-bookings.dto';
import { Body,Controller,Param, Patch,Post,Req,UseGuards} from '@nestjs/common';

import { ApiBadRequestResponse,ApiConflictResponse,ApiCookieAuth,ApiCreatedResponse,ApiForbiddenResponse,ApiInternalServerErrorResponse,ApiNotFoundResponse,ApiOperation,ApiTags,ApiUnauthorizedResponse,} from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import {AuthGuard,AuthenticatedRequest} from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { CreateFlightDto } from './dto/create-flight.dto';
import { CreateCabinsDto } from './dto/create-cabins.dto';
import { UpdateFlightDto } from './dto/update-flight.dto';
import { UpdateCabinDto } from './dto/update-cabin.dto';
import { FlightsService } from './flights.service';
import { Get, Query } from '@nestjs/common';
import { FlightSearchDto, RoundTripSearchDto } from './dto/flight-search.dto';

@ApiTags('Flights')
@ApiUnauthorizedResponse({
  type: ApiErrorDto,
  description: 'A valid unrestricted account session is required.',
})
@ApiForbiddenResponse({
  type: ApiErrorDto,
  description: 'Airline moderator role and one assigned airline are required.',
})
@ApiBadRequestResponse({
  type: ApiErrorDto,
  description: 'Invalid request fields or duplicate cabin classes.',
})
@ApiConflictResponse({
  type: ApiErrorDto,
  description: 'Duplicate flight/cabin or a flight that cannot be edited.',
})
@ApiInternalServerErrorResponse({ type: ApiErrorDto })
@Controller('flights')
export class FlightsController {
  constructor(
    private readonly flights: FlightsService,
  ) {}

  @Get(':flightId/bookings')
  @Header('Cache-Control', 'no-store')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'ACC-11/FLT-29: view bookings for a flight of your assigned airline', description: 'Read-only, ten per page. Includes references, passenger names, cabin, seats and status; excludes passport/ID numbers, birth dates and payment details. Admins use /api/admin/bookings.' })
  @ApiOkResponse({ type: ModeratorFlightBookingsPageDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Flight unknown or belongs to a different airline.' })
  listBookings(@Req() req: AuthenticatedRequest, @Param() params: FlightIdParamsDto, @Query() query: ModeratorFlightBookingsQueryDto) {
    return this.flights.listOwnFlightBookings(req.user!.userId, params.flightId, query.page ?? 1);
  }

  // FLT-03: Create flight.

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({
    summary: 'Create a flight using airport-local date-times (FLT-03)',
  })
  @ApiCreatedResponse({
    type: Object,
    description: 'Created scheduled flight with UTC departure and arrival times.',
  })
  create(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateFlightDto,
  ) {
    return this.flights.createFlight(
      req.user!.userId,
      body,
    );
  }

  // FLT-04: Create cabins.

  @Post(':flightId/cabins')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({
    summary: 'Define cabin classes and inventory for a flight (FLT-04)',
    description:
      'All requested cabins are created in one MongoDB transaction. If any class conflicts, the entire batch is rolled back. Requires a replica set (already required for booking holds).',
  })
  @ApiCreatedResponse({
    type: Object,
    isArray: true,
    description: 'All requested cabin inventories were created.',
  })
  @ApiNotFoundResponse({
    type: ApiErrorDto,
    description: 'Flight not found for your assigned airline.',
  })
  createCabins(
    @Req() req: AuthenticatedRequest,
    @Param('flightId') flightId: string,
    @Body() body: CreateCabinsDto,
  ) {
    return this.flights.createCabins(
      req.user!.userId,
      flightId,
      body,
    );
  }

  // FLT-05: Update flight schedule.

  @Patch(':flightId')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({
    summary: 'Edit departure and arrival times (FLT-05)',
  })
  update(
    @Req() req: AuthenticatedRequest,
    @Param('flightId') flightId: string,
    @Body() body: UpdateFlightDto,
  ) {
    return this.flights.updateFlight(
      req.user!.userId,
      flightId,
      body,
    );
  }

  // FLT-05: Update cabin inventory.

  @Patch(':flightId/cabins/:cabinId')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({
    summary: 'Edit cabin price, seats and baggage allowance (FLT-05)',
  })
  updateCabin(
    @Req() req: AuthenticatedRequest,
    @Param('flightId') flightId: string,
    @Param('cabinId') cabinId: string,
    @Body() body: UpdateCabinDto,
  ) {
    return this.flights.updateCabin(
      req.user!.userId,
      flightId,
      cabinId,
      body,
    );
  }

  // FLT-06: Cancel flight.

  @Post(':flightId/cancel')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({
    summary: 'Cancel a scheduled flight (FLT-06)',
  })
  cancel(
    @Req() req: AuthenticatedRequest,
    @Param('flightId') flightId: string,
  ) {
    return this.flights.cancelFlight(
      req.user!.userId,
      flightId,
    );
  }
 // FLT-11, FLT-15: Search one-way flights.
@Get('search')
@ApiOperation({
  summary: 'Search available one-way flights (FLT-11, FLT-15)',
})
search(@Query() query: FlightSearchDto) {
  return this.flights.search(query);
}

// FLT-12: Search round-trip flights.
@Get('search/round-trip')
@ApiOperation({
  summary: 'Search outbound and return flights (FLT-12)',
})
roundTrip(@Query() query: RoundTripSearchDto) {
  return this.flights.searchRoundTrip(query);
}
@Get(':flightId')
  @ApiOperation({ summary: 'Get flight details including local times, cabin inventory and policies (FLT-17, FLT-30)' })
  details(@Param('flightId') id: string) { return this.flights.details(id); }
}
