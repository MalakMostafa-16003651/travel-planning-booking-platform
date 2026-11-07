import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCookieAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogPageDto } from './dto/audit-log-response.dto';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

@ApiTags('Administration')
@Controller('admin/audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogsService) {}

  @Get()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('accessToken')
  @ApiOperation({
    summary: 'GEN-07: list the audit log of admin actions',
    description: 'ADMIN only. Newest first, 10 per page (GEN-05). Optional filters: action, targetType, adminId and a from/to date range. Entries are append-only.',
  })
  @ApiOkResponse({ type: AuditLogPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid page, filter or date range.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Not an administrator.' })
  list(@Query() query: ListAuditLogsQueryDto): Promise<AuditLogPageDto> {
    return this.auditLogs.list(query);
  }
}
