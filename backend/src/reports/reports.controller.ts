import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthenticatedRequest, AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportDto } from './dto/report-response.dto';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiCookieAuth('accessToken')
  @ApiOperation({
    summary: 'GEN-09: report a post, comment, review or itinerary',
    description: 'Registered users only. A reason is required (5–500 characters). Each user can report a particular item at most once. Itineraries return 400 until their module supports hiding.',
  })
  @ApiCreatedResponse({ type: ReportDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid fields, or a content type not supported yet.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Only registered users can report.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'The reported item does not exist.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'You have already reported this item.' })
  create(@Req() request: AuthenticatedRequest, @Body() input: CreateReportDto): Promise<ReportDto> {
    return this.reports.create(request.user!.userId, input);
  }
}
