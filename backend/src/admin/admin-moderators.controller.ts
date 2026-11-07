import { Body, Controller, Header, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthenticatedRequest, AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { AdminModeratorsService } from './admin-moderators.service';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { ModeratorDto } from './dto/moderator-response.dto';

@ApiTags('Administration')
@Controller('admin/moderators')
export class AdminModeratorsController {
  constructor(private readonly moderators: AdminModeratorsService) {}

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('accessToken')
  @ApiOperation({
    summary: 'ACC-13: create a hotel or airline moderator',
    description: 'ADMIN only. Name, email and role, linked to exactly one airline (AIRLINE_MODERATOR) or hotel (HOTEL_MODERATOR), with an admin-set temporary password. The moderator must change it at first login. The password is never returned. Audited (GEN-07).',
  })
  @ApiCreatedResponse({ type: ModeratorDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid fields or temporary password.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Not an administrator.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No airline or hotel with this ID for the chosen role.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Email is already registered.' })
  create(@Req() request: AuthenticatedRequest, @Body() input: CreateModeratorDto): Promise<ModeratorDto> {
    return this.moderators.create(request.user!.userId, input);
  }
}
