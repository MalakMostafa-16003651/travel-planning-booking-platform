import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCookieAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { AdminBookingsService } from './admin-bookings.service';
import { AdminBookingPageDto } from './dto/admin-booking-response.dto';
import { ListAdminBookingsQueryDto } from './dto/list-admin-bookings-query.dto';

@ApiTags('Administration')
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(private readonly bookings: AdminBookingsService) {}

  @Get()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('accessToken')
  @ApiOperation({
    summary: 'ACC-17: read-only list of all bookings',
    description: 'ADMIN only. Reference, user, provider, travel date, amount and status; newest first, 10 per page (GEN-05). Filter by type, status and travel-date range. Passport numbers and other passenger details are never included. type=FLIGHT (default) or HOTEL.',
  })
  @ApiOkResponse({ type: AdminBookingPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid page, filter or date range.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Not an administrator.' })
  list(@Query() query: ListAdminBookingsQueryDto): Promise<AdminBookingPageDto> {
    return this.bookings.list(query);
  }
}
