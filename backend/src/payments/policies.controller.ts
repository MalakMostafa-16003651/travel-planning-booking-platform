import { Controller, Get, Header, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { BookingParamsDto } from './dto/booking-params.dto';
import { PoliciesService } from './policies.service';

@ApiTags('Payments')
@ApiCookieAuth('accessToken')
@ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
@ApiForbiddenResponse({ type: ApiErrorDto, description: 'Only role USER can pay for bookings.' })
@ApiBadRequestResponse({ type: ApiErrorDto, description: 'type must be flight or hotel, and id a valid id.' })
@ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such booking belongs to you.' })
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('bookings')
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @Get(':type/:id/policies')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'PAY-02: view the booking policies and amount before paying' })
  @ApiOkResponse({ description: 'Policies, amount (major units) and currency of the booking.' })
  getPolicies(@Param() params: BookingParamsDto, @Req() request: AuthenticatedRequest) {
    return this.policies.getPolicies(params.type, params.id, request.user!.userId);
  }

  @Post(':type/:id/accept-policies')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'PAY-02: accept the booking policies',
    description: 'Required before POST /api/payments. If the provider changes the policies, they must be accepted again.',
  })
  @ApiOkResponse({ description: 'The stored PolicyAcceptance.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The booking is not PENDING.' })
  acceptPolicies(@Param() params: BookingParamsDto, @Req() request: AuthenticatedRequest) {
    return this.policies.acceptPolicies(params.type, params.id, request.user!.userId);
  }
}
