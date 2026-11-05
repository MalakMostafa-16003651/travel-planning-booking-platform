import {Body,Controller,Param,Patch,Post,Req,UseGuards,} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags,} from '@nestjs/swagger';
import {AuthGuard, AuthenticatedRequest,} from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { CreateFlightDto } from './dto/create-flight.dto';
import { CreateCabinsDto } from './dto/create-cabins.dto';
import { UpdateFlightDto } from './dto/update-flight.dto';
import { UpdateCabinDto } from './dto/update-cabin.dto';
import { FlightsService } from './flights.service';

@ApiTags('Flights')
@Controller('flights')
export class FlightsController {
  constructor(
    private readonly flights: FlightsService,
  ) {}

  // FLT-03: Create flight.

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({
    summary: 'Create a flight (FLT-03)',
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
    summary: 'Define cabin classes and inventory (FLT-04)',
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
}