import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthenticatedRequest, AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { ContentParamsDto, ReportIdParamsDto } from './dto/params.dto';
import { ContentModerationResultDto, ReportDto, ReportPageDto } from './dto/report-response.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { ReportsService } from './reports.service';

@ApiTags('Administration')
@ApiCookieAuth('accessToken')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing or expired session.' })
@ApiForbiddenResponse({ type: ApiErrorDto, description: 'Not an administrator.' })
@Controller('admin')
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'GEN-09/GEN-10: list reports',
    description: 'ADMIN only. OPEN reports by default (status filter for resolved ones), newest first, 10 per page (GEN-05), with the reporter\'s name. Optional targetType filter.',
  })
  @ApiOkResponse({ type: ReportPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid page or filter.' })
  list(@Query() query: ListReportsQueryDto): Promise<ReportPageDto> {
    return this.reports.list(query);
  }

  @Patch('reports/:id')
  @ApiOperation({
    summary: 'GEN-10: resolve a report by dismissing it, hiding the content or deleting it',
    description: 'ADMIN only. Body { action: DISMISS | HIDE | DELETE }. HIDE and DELETE act on the content and close every open report about it. Audited (GEN-07).',
  })
  @ApiOkResponse({ type: ReportDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid ID or action, or a content type not supported yet.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such report.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The report is already resolved.' })
  resolve(@Req() request: AuthenticatedRequest, @Param() params: ReportIdParamsDto, @Body() body: ResolveReportDto): Promise<ReportDto> {
    return this.reports.resolve(request.user!.userId, params.id, body.action);
  }

  @Patch('content/:type/:id/hide')
  @HttpCode(200)
  @ApiOperation({
    summary: 'GEN-10: hide a post, comment, review or itinerary',
    description: 'ADMIN only, with or without a report. Hidden content is visible only to its author and admins. Closes open reports about it. Audited (GEN-07).',
  })
  @ApiOkResponse({ type: ContentModerationResultDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid type or ID, or a content type not supported yet.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such content.' })
  hide(@Req() request: AuthenticatedRequest, @Param() params: ContentParamsDto): Promise<ContentModerationResultDto> {
    return this.reports.moderate(request.user!.userId, params.type, params.id, 'hide');
  }

  @Patch('content/:type/:id/unhide')
  @HttpCode(200)
  @ApiOperation({
    summary: 'GEN-10: make hidden content visible again',
    description: 'ADMIN only. Reverses a hide. Audited (GEN-07).',
  })
  @ApiOkResponse({ type: ContentModerationResultDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid type or ID, or a content type not supported yet.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such content.' })
  unhide(@Req() request: AuthenticatedRequest, @Param() params: ContentParamsDto): Promise<ContentModerationResultDto> {
    return this.reports.moderate(request.user!.userId, params.type, params.id, 'unhide');
  }

  @Delete('content/:type/:id')
  @ApiOperation({
    summary: 'GEN-10: delete a post, comment, review or itinerary',
    description: 'ADMIN only, with or without a report. Deletes through the content owner, so related data is cleaned up (a post\'s comments, likes and images). Closes open reports about it. Audited (GEN-07).',
  })
  @ApiOkResponse({ type: ContentModerationResultDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid type or ID, or a content type not supported yet.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such content.' })
  remove(@Req() request: AuthenticatedRequest, @Param() params: ContentParamsDto): Promise<ContentModerationResultDto> {
    return this.reports.moderate(request.user!.userId, params.type, params.id, 'delete');
  }
}
