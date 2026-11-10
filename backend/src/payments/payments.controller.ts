import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, type RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { ApiBadGatewayResponse, ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { IdParamDto } from './dto/id-param.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // Declared before ':id' routes. No login: Stripe sends no cookie, it signs the raw body.
  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'PAY-01: Stripe webhook (signature verified)', description: 'Handles payment_intent.succeeded, payment_intent.payment_failed, charge.refunded and refund.updated. Other events are acknowledged and ignored.' })
  @ApiHeader({ name: 'stripe-signature', required: true })
  @ApiOkResponse({ description: 'Event received.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Missing or invalid signature.' })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'STRIPE_WEBHOOK_SECRET is not configured.' })
  handleWebhook(@Req() request: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    return this.payments.handleWebhook(request.rawBody, signature);
  }

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('accessToken')
  @ApiOperation({
    summary: 'PAY-01: pay for a booking (returns the Stripe clientSecret)',
    description: 'Amount and currency always come from the booking. Requires accepted policies (PAY-02). A PENDING payment for the same booking is returned again.',
  })
  @ApiCreatedResponse({ description: '{ payment, clientSecret }. Confirm the payment with Stripe.js using clientSecret.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid body.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Only role USER can pay.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such booking belongs to you.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Booking not PENDING, hold expired, policies not accepted, or already paid.' })
  @ApiBadGatewayResponse({ type: ApiErrorDto, description: 'Stripe error.' })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'Hotel checkout is temporarily unavailable until its booking confirmation connection is ready.' })
  create(@Body() dto: CreatePaymentDto, @Req() request: AuthenticatedRequest) {
    return this.payments.create(dto, request.user!);
  }

  @Post(':id/retry')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'PAY-01: retry a failed payment', description: 'Creates a new PaymentIntent on the same Payment while the booking hold lasts.' })
  @ApiOkResponse({ description: '{ payment, clientSecret }.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Only role USER can pay.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such payment or booking belongs to you.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'Payment not FAILED, needs an admin check, or booking no longer payable.' })
  @ApiBadGatewayResponse({ type: ApiErrorDto, description: 'Stripe error.' })
  @ApiServiceUnavailableResponse({ type: ApiErrorDto, description: 'Hotel checkout is temporarily unavailable; the existing payment is preserved.' })
  retry(@Param() params: IdParamDto, @Req() request: AuthenticatedRequest) {
    return this.payments.retry(params.id, request.user!);
  }

  @Get(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER, UserRole.ADMIN)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'PAY-01: view a payment (a PENDING one is checked with Stripe)', description: 'The owner or an ADMIN.' })
  @ApiOkResponse({ description: 'The Payment.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Role not allowed.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such payment belongs to you.' })
  @ApiBadGatewayResponse({ type: ApiErrorDto, description: 'Stripe error.' })
  findOne(@Param() params: IdParamDto, @Req() request: AuthenticatedRequest) {
    return this.payments.findOne(params.id, request.user!);
  }
}
