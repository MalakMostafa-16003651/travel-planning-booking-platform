import { Body, Controller, Get, Header, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiForbiddenResponse, ApiInternalServerErrorResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthenticatedRequest, AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { AdminAccountsService } from './admin-accounts.service';
import { AccountIdParamsDto } from './dto/account-id-params.dto';
import { AccountDto, AccountPageDto } from './dto/account-response.dto';
import { AccountStatusChangeDto } from './dto/account-status-change.dto';
import { ListAccountsQueryDto } from './dto/list-accounts-query.dto';

@ApiTags('Administration')
@ApiCookieAuth('accessToken')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing or expired session.' })
@ApiForbiddenResponse({ type: ApiErrorDto, description: 'Not an administrator.' })
@Controller('admin/accounts')
export class AdminAccountsController {
  constructor(private readonly accounts: AdminAccountsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'ACC-14: list all accounts',
    description: 'ADMIN only. Name, email, role, status and registration date; newest first, 10 per page (GEN-05). Search by name or email; filter by role and status.',
  })
  @ApiOkResponse({ type: AccountPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid page, search or filter.' })
  list(@Query() query: ListAccountsQueryDto): Promise<AccountPageDto> {
    return this.accounts.list(query);
  }

  @Patch(':id/suspend')
  @ApiInternalServerErrorResponse({ type: ApiErrorDto, description: 'Status, audit or notification persistence failed; all changes are rolled back.' })
  @ApiOperation({
    summary: 'ACC-15/ACC-16: suspend a user or moderator',
    description: 'ADMIN only. ACTIVE → SUSPENDED. The account cannot log in and its sessions stop working; bookings stay valid and content stays visible (ACC-16). Administrators cannot be suspended. Status, audit (GEN-07) and inbox notification (GEN-01) commit together; a failed write rolls back all three.',
  })
  @ApiOkResponse({ type: AccountDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid ID or reason, or the target is an administrator.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such account.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The account is not ACTIVE.' })
  suspend(@Req() request: AuthenticatedRequest, @Param() params: AccountIdParamsDto, @Body() body: AccountStatusChangeDto): Promise<AccountDto> {
    return this.accounts.suspend(request.user!.userId, params.id, body.reason);
  }

  @Patch(':id/reactivate')
  @ApiInternalServerErrorResponse({ type: ApiErrorDto, description: 'Status, audit or notification persistence failed; all changes are rolled back.' })
  @ApiOperation({
    summary: 'ACC-15/ACC-16: reactivate a suspended user or moderator',
    description: 'ADMIN only. SUSPENDED → ACTIVE. Self-deactivated accounts (ACC-12) are not reactivated here. Status, audit (GEN-07) and inbox notification (GEN-01) commit together; a failed write rolls back all three.',
  })
  @ApiOkResponse({ type: AccountDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid ID or reason, or the target is an administrator.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such account.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The account is not SUSPENDED.' })
  reactivate(@Req() request: AuthenticatedRequest, @Param() params: AccountIdParamsDto, @Body() body: AccountStatusChangeDto): Promise<AccountDto> {
    return this.accounts.reactivate(request.user!.userId, params.id, body.reason);
  }
}
