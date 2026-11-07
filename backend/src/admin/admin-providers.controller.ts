import { Controller, HttpCode, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthenticatedRequest, AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { AdminProvidersService } from './admin-providers.service';
import { ProviderParamsDto } from './dto/provider-params.dto';
import { ProviderStatusDto } from './dto/provider-status-response.dto';

@ApiTags('Administration')
@ApiCookieAuth('accessToken')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing or expired session.' })
@ApiForbiddenResponse({ type: ApiErrorDto, description: 'Not an administrator.' })
@ApiBadRequestResponse({ type: ApiErrorDto, description: 'Type is not airline or hotel, or the ID is invalid.' })
@ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such airline or hotel.' })
@Controller('admin/providers')
export class AdminProvidersController {
  constructor(private readonly providers: AdminProvidersService) {}

  @Patch(':type/:id/deactivate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'ACC-15: deactivate an airline or hotel',
    description: 'ADMIN only. :type is airline or hotel. The provider is hidden from search and cannot be booked; existing Confirmed bookings remain valid. Separate from suspending its moderator. Its moderators and customers with Confirmed bookings are notified (GEN-01); audited (GEN-07).',
  })
  @ApiOkResponse({ type: ProviderStatusDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Already deactivated.' })
  deactivate(@Req() request: AuthenticatedRequest, @Param() params: ProviderParamsDto): Promise<ProviderStatusDto> {
    return this.providers.deactivate(request.user!.userId, params.type, params.id);
  }

  @Patch(':type/:id/reactivate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'ACC-15: reactivate an airline or hotel',
    description: 'ADMIN only. The provider becomes searchable and bookable again. Its moderators are notified (GEN-01); audited (GEN-07).',
  })
  @ApiOkResponse({ type: ProviderStatusDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Already active.' })
  reactivate(@Req() request: AuthenticatedRequest, @Param() params: ProviderParamsDto): Promise<ProviderStatusDto> {
    return this.providers.reactivate(request.user!.userId, params.type, params.id);
  }
}
