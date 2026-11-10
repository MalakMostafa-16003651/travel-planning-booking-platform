import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCookieAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AnalyticsPageDto, AnalyticsQueryDto } from './dto/analytics.dto';

@ApiTags('Administration')
@Controller('admin/analytics')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiCookieAuth('accessToken')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'BON-01: bookings and revenue per provider', description: 'ADMIN only. Select inclusive UTC confirmation dates, maximum 366 days. Includes successfully paid bookings and their completed refunds through generatedAt; excludes unpaid holds, failed payments and late-payment compensation. Amounts are USD cents. Hotel receipts belong to that hotel; mixed-airline gross receipts use stored segment fare weights; refunds use allocated gross weights, with deterministic cent rounding. Counts across airlines are not additive. Ten providers per page, sorted by net revenue. Read-only API for the M2 dashboard; does not calculate provider payouts or contact Stripe.' })
  @ApiOkResponse({ type: AnalyticsPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  @ApiForbiddenResponse({ type: ApiErrorDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'Inconsistent financial source records; no partial report returned.' })
  report(@Query() query: AnalyticsQueryDto): Promise<AnalyticsPageDto> { return this.analytics.report(query); }
}
