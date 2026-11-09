import { CancelHotelBookingDto, HotelCancellationQuoteDto } from './dto/cancel-hotel-booking.dto';
import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
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

  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'HTL-16/HTL-18: hold one or more rooms for 10 minutes',
    description: 'Books one or more rooms of the same hotel for the same dates as one PENDING (Pending Payment) reservation. Every room is held together for 10 minutes in one transaction; if any room overlaps a blocked range, a booked range or an unexpired hold, nothing is held (409). Prices are copied from the rooms now; the total is nights x price per room, in minor units (USD). Unpaid holds become EXPIRED and release their rooms.',
  })
  @ApiCreatedResponse({ type: HotelBookingDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid input: dates (check-out not after check-in, check-in in the past), invalid ids, repeated room, no adult in the reservation, a room without guests, child age outside 0-17, or a room over its capacity.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Hotel not found or deactivated, or a room not found, inactive or not of this hotel.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'A room is not available for these dates; nothing was held.' })
  create(@Body() input: CreateHotelBookingDto, @Req() request: AuthenticatedRequest): Promise<HotelBookingDto> {
    return this.bookings.hold(input, request.user!.userId);
  }

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
  @ApiOperation({ summary: 'HTL-20: view one of your hotel reservations', description: 'Full details: rooms with guests and prices, dates, total, status and the policy shown before payment. HTL-17 confirmation and the booking reference appear only after backend-verified payment; clients cannot directly confirm a reservation.' })
  @ApiOkResponse({ type: HotelBookingDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'The id is not a valid ID.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such reservation belongs to you.' })
  async get(@Param() params: HotelBookingIdParamsDto, @Req() request: AuthenticatedRequest): Promise<HotelBookingDto> {
    return this.bookings.getDetails(params.id, request.user!.userId);
  }

  @Get(':id/cancellation-quote')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'HTL-21: preview a whole-reservation cancellation', description: 'Owner-only. Uses the policy saved at booking time, full total and UTC days before check-in. Changes nothing. Return the quoteToken with confirmed:true within five minutes to cancel.' })
  @ApiOkResponse({ type: HotelCancellationQuoteDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid reservation ID.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such reservation belongs to you.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Not Confirmed or check-in date has arrived.' })
  quote(@Param() params: HotelBookingIdParamsDto, @Req() request: AuthenticatedRequest) {
    return this.bookings.getCancellationQuote(params.id, request.user!.userId);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'HTL-21: cancel your Confirmed reservation as a whole', description: 'Requires explicit confirmation and a current quote token. Atomically releases all rooms before check-in, then requests the quoted refund. A gateway outage leaves refundStatus PENDING for maintenance retry. Partial cancellation is not supported.' })
  @ApiOkResponse({ type: HotelBookingDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid ID, missing confirmation/token, or unknown fields such as room selections or a client refund amount.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such reservation belongs to you.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Not Confirmed, check-in reached, expired proof or changed refund quote.' })
  cancel(@Param() params: HotelBookingIdParamsDto, @Body() dto: CancelHotelBookingDto, @Req() request: AuthenticatedRequest) {
    return this.bookings.cancel(params.id, request.user!.userId, dto.quoteToken);
  }
}
