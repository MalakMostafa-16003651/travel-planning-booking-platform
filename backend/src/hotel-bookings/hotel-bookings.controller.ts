import { Controller, Get, Header, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCookieAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { HotelBookingIdParamsDto } from './dto/hotel-booking-id-params.dto';
import { HotelBookingDto, HotelBookingPageDto } from './dto/hotel-booking-response.dto';
import { ListHotelBookingsQueryDto } from './dto/list-hotel-bookings-query.dto';
import { HotelBookingsService } from './hotel-bookings.service';

@ApiTags('Hotel bookings')
@ApiCookieAuth('accessToken')
@ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
@ApiForbiddenResponse({ type: ApiErrorDto, description: 'Only role USER has hotel reservations.' })
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(private readonly bookings: HotelBookingsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'HTL-20: list your hotel reservations',
    description: 'Without a group, all your reservations, newest first. group=CANCELLED lists cancelled and expired ones. Page size is 10. Amounts are in minor units (USD).',
  })
  @ApiOkResponse({ type: HotelBookingPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid group or page.' })
  list(@Query() query: ListHotelBookingsQueryDto, @Req() request: AuthenticatedRequest): Promise<HotelBookingPageDto> {
    return this.bookings.listMine(request.user!.userId, query.group, query.page);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'HTL-20: view one of your hotel reservations', description: 'Full details: rooms with guests and prices, dates, total, status and the policy shown before payment.' })
  @ApiOkResponse({ type: HotelBookingDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'The id is not a valid ID.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such reservation belongs to you.' })
  async get(@Param() params: HotelBookingIdParamsDto, @Req() request: AuthenticatedRequest): Promise<HotelBookingDto> {
    return HotelBookingDto.from(await this.bookings.getMine(params.id, request.user!.userId));
  }
}
