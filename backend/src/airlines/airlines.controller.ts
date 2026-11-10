import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { Airline } from './schemas/airline.schema';
import { AirlinesService } from './airlines.service';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';
import { UpdateAirlinePoliciesDto } from './dto/update-airline-policies.dto';

@ApiTags('Airlines')
@Controller('airlines')
export class AirlinesController {
  constructor(private readonly airlines: AirlinesService) {}

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'Create an airline profile (Admin, FLT-01)' })
  @ApiCreatedResponse({ description: 'Airline created', type: Object })
  create(@Req() req: AuthenticatedRequest, @Body() body: CreateAirlineDto): Promise<Airline> { return this.airlines.create(body, req.user!.userId); }
  @Get('me')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOkResponse({ description: 'The moderator assigned airline' })
  me(@Req() req: AuthenticatedRequest): Promise<Airline> { return this.airlines.getMine(req.user!.userId); }

  @Patch('me')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'Edit own airline name, code and logo (FLT-01)' })
  @ApiOkResponse({ description: 'Updated airline profile' })
  updateMe(@Req() req: AuthenticatedRequest, @Body() body: UpdateAirlineDto): Promise<Airline> {
    return this.airlines.updateMine(req.user!.userId, body);
  }

  @Patch('me/policies')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'Update baggage and cancellation policies (FLT-08, FLT-09)' })
  @ApiOkResponse({ description: 'Updated airline policies' })
  updatePolicies(@Req() req: AuthenticatedRequest, @Body() body: UpdateAirlinePoliciesDto): Promise<Airline> {
    return this.airlines.updatePoliciesMine(req.user!.userId, body);
  }
}
