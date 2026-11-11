import { Body, Controller, Delete, Header, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiForbiddenResponse, ApiInternalServerErrorResponse, ApiNoContentResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { clearAuthenticationCookies } from '../auth/auth-cookies';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { AccountDeactivationService } from './account-deactivation.service';
import { DeactivateAccountDto } from './dto/deactivate-account.dto';

@ApiTags('Users')
@ApiCookieAuth('accessToken')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('users/me')
export class AccountDeactivationController {
  constructor(private readonly deactivation: AccountDeactivationService) {}

  @Post('deactivate')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'ACC-12: deactivate your own account after confirmation',
    description: 'Requires confirmed:true. Blocks future flight legs and hotel stays that have not checked out (UTC). Coordinates atomically with both booking confirmation paths. On success, sessions are revoked and all auth cookies are cleared. Content is retained; existing visibility/anonymization rules apply. Identity/version come only from the authenticated session.' })
  @ApiNoContentResponse({ description: 'Account deactivated, old sessions unusable, authentication cookies expired.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Confirmation missing/false or unknown fields.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, restricted, expired, revoked or stale session/account.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Only registered users; cross-origin request rejected.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'An upcoming Confirmed booking blocks deactivation, or the account changed concurrently.' })
  @ApiInternalServerErrorResponse({ type: ApiErrorDto, description: 'A dependency or transaction failed; no deactivation is committed and cookies are preserved for retry.' })
  async deactivate(@Body() _input: DeactivateAccountDto, @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.deactivation.deactivate(request.user!.userId, request.authenticatedCredentialVersion!);
    clearAuthenticationCookies(response);
  }

  @Delete()
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'ACC-12: deactivate your own account (PDF path for POST /api/users/me/deactivate)',
    description: 'Same body ({ "confirmed": true }), rules and result as POST /api/users/me/deactivate. The account is deactivated, not erased.' })
  @ApiNoContentResponse({ description: 'Account deactivated, old sessions unusable, authentication cookies expired.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Confirmation missing/false or unknown fields.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'An upcoming Confirmed booking blocks deactivation.' })
  async remove(@Body() input: DeactivateAccountDto, @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.deactivate(input, request, response);
  }
}