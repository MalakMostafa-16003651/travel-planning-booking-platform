import { Body, Controller, Header, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCookieAuth, ApiForbiddenResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { AuthGuard } from './auth.guard';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import { UserIdParamsDto } from './dto/user-id-params.dto';
import { PasswordManagementService } from './password-management.service';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

@ApiTags('Account administration')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly passwords: PasswordManagementService) {}

  @Post(':userId/reset-password')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('accessToken')
  @ApiOperation({
    summary: 'ACC-07a: administrator sets a temporary password',
    description: 'ADMIN only. Targets users/moderators, never administrators. Stores only a salted hash, invalidates all prior normal/restricted sessions, resets failed-login lockout and requires a change at next eligible login. Account status stays unchanged. Password delivery is outside this API; no password is returned.',
  })
  @ApiNoContentResponse({ description: 'Temporary password set. Target must complete the restricted change flow.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid user ID, password policy or unknown fields.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing or ineligible session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Non-admin account or cross-origin request.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Target is not an existing user/moderator.' })
  async resetPassword(@Param() params: UserIdParamsDto, @Body() input: AdminResetPasswordDto): Promise<void> {
    await this.passwords.setTemporaryPassword(params.userId, input);
  }
}
