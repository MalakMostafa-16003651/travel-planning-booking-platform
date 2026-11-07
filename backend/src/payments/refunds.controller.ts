import { Controller, Get, Header, Param, Req, UseGuards } from '@nestjs/common';
import { ApiBadGatewayResponse, ApiBadRequestResponse, ApiCookieAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { IdParamDto } from './dto/id-param.dto';
import { RefundsService } from './refunds.service';

@ApiTags('Refunds')
@ApiCookieAuth('accessToken')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER, UserRole.ADMIN)
@Controller('refunds')
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'PAY-03: view a refund and its status (PENDING, REFUNDED or FAILED)',
    description: 'The owner or an ADMIN. The id is the refundId on the booking details. A PENDING refund is checked with Stripe first; if Stripe cannot be reached, the stored status is returned.',
  })
  @ApiOkResponse({ description: 'The Refund.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Role not allowed.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such refund belongs to you.' })
  @ApiBadGatewayResponse({ type: ApiErrorDto, description: 'Stripe error.' })
  findOne(@Param() params: IdParamDto, @Req() request: AuthenticatedRequest) {
    return this.refunds.findOne(params.id, request.user!);
  }
}
