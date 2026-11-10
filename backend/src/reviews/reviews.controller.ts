import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiCookieAuth, ApiCreatedResponse, ApiForbiddenResponse, ApiNoContentResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UserRole } from '../common/enums/user-role.enum';
import { HotelBookingIdParamsDto } from '../hotel-bookings/dto/hotel-booking-id-params.dto';
import { OptionalAuthGuard } from '../itineraries/optional-auth.guard';
import { CreateReviewDto } from './dto/create-review.dto';
import { HotelIdParamsDto, ListReviewsQueryDto, ReviewIdParamsDto } from './dto/review-params.dto';
import { HotelReviewsPageDto, ReviewDto } from './dto/review-response.dto';
import { ReviewReplyDto } from './dto/review-reply.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('Hotel reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post('hotel-bookings/:id/review')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiCookieAuth('accessToken')
  @ApiOperation({
    summary: 'HTL-23: rate and review a completed stay',
    description: 'One rating (1-5) and an optional review (max 1000 characters) per Completed reservation, whatever the number of rooms.',
  })
  @ApiCreatedResponse({ type: ReviewDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id, rating or review text.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Only role USER can review.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such reservation belongs to you.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The stay is not Completed, or it already has a review.' })
  create(@Param() params: HotelBookingIdParamsDto, @Body() input: CreateReviewDto, @Req() request: AuthenticatedRequest): Promise<ReviewDto> {
    return this.reviews.create(params.id, input, request.user!);
  }

  @Post('reviews/:id/reply')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.HOTEL_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({
    summary: 'HTL-26 (bonus): reply to a review of your hotel',
    description: 'Only a HOTEL_MODERATOR assigned to the review\'s hotel. One reply per review (max 1000 characters), shown publicly with the review. Hidden reviews cannot be replied to.',
  })
  @ApiCreatedResponse({ type: ReviewDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id, or reply text missing, empty or over 1000 characters.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Not a HOTEL_MODERATOR, or not assigned to this review\'s hotel.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Review not found.' })
  @ApiConflictResponse({ type: ApiErrorDto, description: 'The review is hidden, or already has a reply.' })
  reply(@Param() params: ReviewIdParamsDto, @Body() input: ReviewReplyDto, @Req() request: AuthenticatedRequest): Promise<ReviewDto> {
    return this.reviews.reply(params.id, input, request.user!.userId);
  }

  @Patch('reviews/:id/reply')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.HOTEL_MODERATOR)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'HTL-26 (bonus): edit your reply', description: 'Only the moderator who wrote the reply, while still assigned to the hotel.' })
  @ApiOkResponse({ type: ReviewDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id, or reply text missing, empty or over 1000 characters.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Not a HOTEL_MODERATOR of this hotel, or not your reply.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Review or reply not found.' })
  updateReply(@Param() params: ReviewIdParamsDto, @Body() input: ReviewReplyDto, @Req() request: AuthenticatedRequest): Promise<ReviewDto> {
    return this.reviews.updateReply(params.id, input, request.user!.userId);
  }

  @Delete('reviews/:id/reply')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.HOTEL_MODERATOR)
  @HttpCode(204)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'HTL-26 (bonus): delete your reply', description: 'Only the moderator who wrote the reply, while still assigned to the hotel. The hotel may then reply again.' })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Not a HOTEL_MODERATOR of this hotel, or not your reply.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Review or reply not found.' })
  async removeReply(@Param() params: ReviewIdParamsDto, @Req() request: AuthenticatedRequest): Promise<void> {
    await this.reviews.removeReply(params.id, request.user!.userId);
  }

  @Patch('reviews/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'HTL-23: edit your review', description: 'Change the rating, the text, or both. An empty or null comment removes the text. The average follows on the next read.' })
  @ApiOkResponse({ type: ReviewDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id, rating or text, or nothing to change.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Not role USER, or not your review.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Review not found.' })
  update(@Param() params: ReviewIdParamsDto, @Body() input: UpdateReviewDto, @Req() request: AuthenticatedRequest): Promise<ReviewDto> {
    return this.reviews.update(params.id, input, request.user!);
  }

  @Delete('reviews/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @HttpCode(204)
  @ApiCookieAuth('accessToken')
  @ApiOperation({ summary: 'HTL-23: delete your review', description: 'The average follows on the next read.' })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid id.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing, invalid or expired session.' })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: 'Not role USER, or not your review.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Review not found.' })
  async remove(@Param() params: ReviewIdParamsDto, @Req() request: AuthenticatedRequest): Promise<void> {
    await this.reviews.remove(params.id, request.user!);
  }

  @Get('hotels/:id/reviews')
  @UseGuards(OptionalAuthGuard)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: "HTL-24: a hotel's average rating, number of ratings and reviews",
    description: 'Guests allowed. Newest first, page size 10. Hidden reviews are listed only for their author and admins and never count in the average. A deactivated author is shown as "Deleted user".',
  })
  @ApiOkResponse({ type: HotelReviewsPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid hotel id or page.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'Hotel not found, or deactivated.' })
  list(@Param() params: HotelIdParamsDto, @Query() query: ListReviewsQueryDto, @Req() request: AuthenticatedRequest): Promise<HotelReviewsPageDto> {
    return this.reviews.listForHotel(params.id, query.page ?? 1, request.user);
  }
}
