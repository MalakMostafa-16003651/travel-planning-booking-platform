import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiProduces, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { CreateFlightBookingDto } from './dto/create-flight-booking.dto';
import { CancellationQuoteDto, FlightBookingDto, FlightBookingPageDto, FlightBookingSummaryDto } from './dto/flight-booking-response.dto';
import { ListFlightBookingsQueryDto } from './dto/list-flight-bookings-query.dto';
import { ETicketService } from './e-ticket.service';
import { assertTraveler, FlightBookingsService } from './flight-bookings.service';

@ApiTags('Flight bookings')
@ApiCookieAuth('accessToken')
@ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
@UseGuards(AuthGuard)
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(private readonly bookings: FlightBookingsService, private readonly eTickets: ETicketService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @ApiOperation({
    summary: 'FLT-19/FLT-21: review a booking summary',
    description: 'Validates passengers and baggage and returns the priced summary. Reserves and stores nothing. All amounts are in minor units.',
  })
  @ApiOkResponse({ type: FlightBookingSummaryDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid passengers, baggage or round-trip selection.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Only role USER can book.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Flight or cabin not found.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Flight not bookable, or not enough seats.' })
  summarize(@Body() input: CreateFlightBookingDto, @Req() request: AuthenticatedRequest): Promise<FlightBookingSummaryDto> {
    assertTraveler(request.user!.role);
    return this.bookings.summarize(input);
  }

  @Post('hold')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'FLT-22: hold seats for 10 minutes',
    description: 'Atomically reserves the seats and creates a PENDING (Pending Payment) booking. Unpaid holds become EXPIRED and release their seats.',
  })
  @ApiCreatedResponse({ type: FlightBookingDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid passengers, baggage or round-trip selection.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Only role USER can book.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Flight or cabin not found.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Flight not bookable, or not enough seats.' })
  hold(@Body() input: CreateFlightBookingDto, @Req() request: AuthenticatedRequest): Promise<FlightBookingDto> {
    assertTraveler(request.user!.role);
    return this.bookings.hold(input, request.user!.userId);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'FLT-25: list your flight bookings', description: 'Filter with group=UPCOMING, PAST or CANCELLED. Page size is 10.' })
  @ApiOkResponse({ type: FlightBookingPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid group or page.' })
  list(@Query() query: ListFlightBookingsQueryDto, @Req() request: AuthenticatedRequest): Promise<FlightBookingPageDto> {
    return this.bookings.listMine(request.user!.userId, query.group, query.page);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'FLT-25: view one of your flight bookings' })
  @ApiOkResponse({ type: FlightBookingDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such booking belongs to you.' })
  async get(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<FlightBookingDto> {
    return FlightBookingDto.from(await this.bookings.getMine(id, request.user!.userId));
  }

  @Get(':id/cancellation-quote')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'FLT-26: preview the refund for a cancellation', description: 'Uses the airline tier for the outbound departure. Changes nothing.' })
  @ApiOkResponse({ type: CancellationQuoteDto })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such booking belongs to you.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Booking is not Confirmed, or has already departed.' })
  quote(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<CancellationQuoteDto> {
    return this.bookings.getCancellationQuote(id, request.user!.userId);
  }

  @Post(':id/cancel')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @ApiOperation({ summary: 'FLT-26: cancel a Confirmed booking', description: 'Returns the seats to inventory and requests any refund.' })
  @ApiOkResponse({ type: FlightBookingDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Only role USER can cancel.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such booking belongs to you.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Booking is not Confirmed, or has already departed.' })
  cancel(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<FlightBookingDto> {
    assertTraveler(request.user!.role);
    return this.bookings.cancel(id, request.user!.userId);
  }

  @Get(':id/e-ticket')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'FLT-23: download the e-ticket PDF' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'PDF e-ticket.', schema: { type: 'string', format: 'binary' } })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such booking belongs to you.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Booking is not Confirmed.' })
  async eTicket(@Param('id') id: string, @Req() request: AuthenticatedRequest): Promise<StreamableFile> {
    const booking = await this.bookings.getTicketableBooking(id, request.user!.userId);
    return new StreamableFile(await this.eTickets.generate(booking), {
      type: 'application/pdf',
      disposition: `attachment; filename="e-ticket-${booking.bookingReference}.pdf"`,
    });
  }
}
