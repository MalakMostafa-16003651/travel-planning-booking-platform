import {Body,Controller,Param,Post,Req,UseGuards,} from '@nestjs/common';
import {ApiBadRequestResponse,ApiConflictResponse,ApiCookieAuth,ApiCreatedResponse,ApiForbiddenResponse,ApiInternalServerErrorResponse,ApiNotFoundResponse,ApiOperation,ApiTags,ApiUnauthorizedResponse,} from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { CreateFlightDto } from './dto/create-flight.dto';
import { CreateCabinsDto } from './dto/create-cabins.dto';
import { FlightsService } from './flights.service';

@ApiTags('Flights')
@ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'A valid unrestricted account session is required.' })
@ApiForbiddenResponse({ type: ApiErrorDto, description: 'Airline moderator role and one assigned airline are required.' })
@ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid request fields or duplicate cabin classes.' })
@ApiConflictResponse({ type: ApiErrorDto, description: 'Duplicate flight/cabin or a flight that cannot be edited.' })
@ApiInternalServerErrorResponse({ type: ApiErrorDto })
@Controller('flights')
export class FlightsController {
constructor(private readonly flights: FlightsService) {}

@Post()
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.AIRLINE_MODERATOR)
@ApiCookieAuth('accessToken')
@ApiOperation({
summary: 'Create a flight using airport-local date-times (FLT-03)',
})
@ApiCreatedResponse({ type: Object, description: 'Created scheduled flight with UTC departure and arrival times.' })
create(
@Req() req: AuthenticatedRequest,
@Body() body: CreateFlightDto,
) {
return this.flights.createFlight(req.user!.userId, body);
}

@Post(':flightId/cabins')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.AIRLINE_MODERATOR)
@ApiCookieAuth('accessToken')
@ApiOperation({
summary: 'Define cabin classes and inventory for a flight (FLT-04)',
description: 'All requested cabins are created in one MongoDB transaction. If any class conflicts, the entire batch is rolled back. Requires a replica set (already required for booking holds).',
})
@ApiCreatedResponse({ type: Object, isArray: true, description: 'All requested cabin inventories were created.' })
@ApiNotFoundResponse({ type: ApiErrorDto, description: 'Flight not found for your assigned airline.' })
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
}
