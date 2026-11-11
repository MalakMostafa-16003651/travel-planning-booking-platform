import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../common/enums/user-role.enum';
import { Airline } from './schemas/airline.schema';
import { AirlinesService } from './airlines.service';
import { CreateAirlineDto } from './dto/create-airline.dto';
import { UpdateAirlineDto } from './dto/update-airline.dto';
import { BaggagePolicyDto, CancellationPolicyDto, UpdateAirlinePoliciesDto } from './dto/update-airline-policies.dto';

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

  // The PDF's endpoint table (section 8.3) names these by airline id. They are the same operations as the
  // /me routes above, restricted to the moderator's own assigned airline (another :id is 404).

  @Patch(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'Edit your airline profile by id: name and code (FLT-01)', description: 'Same as PATCH /api/airlines/me; :id must be your assigned airline. Upload the logo with POST /api/airlines/me/logo.' })
  @ApiOkResponse({ description: 'Updated airline profile' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: ':id is not your assigned airline.' })
  async updateById(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: UpdateAirlineDto): Promise<Airline> {
    await this.airlines.assertOwnAirline(req.user!.userId, id);
    return this.airlines.updateMine(req.user!.userId, body);
  }

  @Put(':id/baggage-policy')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'Set the extra-baggage policy: price per extra bag (>0) and max extra bags per passenger (>=0) (FLT-08)', description: 'Each extra bag has the cabin\'s free-baggage maximum weight. :id must be your assigned airline.' })
  @ApiOkResponse({ description: 'Updated airline policies' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: ':id is not your assigned airline.' })
  async putBaggagePolicy(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: BaggagePolicyDto): Promise<Airline> {
    await this.airlines.assertOwnAirline(req.user!.userId, id);
    return this.airlines.updatePoliciesMine(req.user!.userId, { baggagePolicy: body });
  }

  @Put(':id/cancellation-policy')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.AIRLINE_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'Set the cancellation tiers (FLT-09)', description: 'Each tier: unique daysBeforeDeparture (integer >= 0) and refundPercentage (0-100). A cancellation uses the tier with the highest threshold not exceeding the days remaining, else 0%. :id must be your assigned airline.' })
  @ApiOkResponse({ description: 'Updated airline policies' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: ':id is not your assigned airline.' })
  async putCancellationPolicy(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: CancellationPolicyDto): Promise<Airline> {
    await this.airlines.assertOwnAirline(req.user!.userId, id);
    return this.airlines.updatePoliciesMine(req.user!.userId, { cancellationTiers: body.cancellationTiers });
  }
}
