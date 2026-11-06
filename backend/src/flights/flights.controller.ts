import {Body,Controller,Param,Post,Req,UseGuards,} from '@nestjs/common';
import {ApiCookieAuth,ApiOperation,ApiTags,} from '@nestjs/swagger';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { CreateFlightDto } from './dto/create-flight.dto';
import { CreateCabinsDto } from './dto/create-cabins.dto';
import { FlightsService } from './flights.service';

@ApiTags('Flights')
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
}
