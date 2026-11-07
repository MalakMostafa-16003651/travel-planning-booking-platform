import { Controller, Get, Header, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCookieAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthenticatedRequest, AuthGuard } from '../auth/auth.guard';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { NotificationIdParamsDto } from './dto/notification-id-params.dto';
import { MarkAllReadDto, NotificationDto, NotificationPageDto, UnreadCountDto } from './dto/notification-response.dto';
import { NotificationsService } from './notifications.service';

/** GEN-01. Every logged-in role has an inbox. The owner always comes from the session, never from the request. */
@ApiTags('Notifications')
@ApiCookieAuth('accessToken')
@UseGuards(AuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'GEN-01: list your notifications', description: 'Newest first, 10 per page (GEN-05). unreadOnly=true lists only unread ones. Includes the unread count of the whole inbox.' })
  @ApiOkResponse({ type: NotificationPageDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid page or unreadOnly value.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing or expired session.' })
  list(@Req() request: AuthenticatedRequest, @Query() query: ListNotificationsQueryDto): Promise<NotificationPageDto> {
    return this.notifications.listOwn(request.user!.userId, query);
  }

  @Get('unread-count')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'GEN-01: count your unread notifications', description: 'For the notification badge.' })
  @ApiOkResponse({ type: UnreadCountDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing or expired session.' })
  async unreadCount(@Req() request: AuthenticatedRequest): Promise<UnreadCountDto> {
    return { unreadCount: await this.notifications.countUnread(request.user!.userId) };
  }

  // Declared before ':id/read' so 'read-all' is never treated as an ID.
  @Patch('read-all')
  @ApiOperation({ summary: 'GEN-01: mark all your notifications as read' })
  @ApiOkResponse({ type: MarkAllReadDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing or expired session.' })
  markAllRead(@Req() request: AuthenticatedRequest): Promise<MarkAllReadDto> {
    return this.notifications.markAllRead(request.user!.userId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'GEN-01: mark one of your notifications as read' })
  @ApiOkResponse({ type: NotificationDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: 'Invalid notification ID.' })
  @ApiUnauthorizedResponse({ type: ApiErrorDto, description: 'Missing or expired session.' })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: 'No such notification in your inbox.' })
  markRead(@Req() request: AuthenticatedRequest, @Param() params: NotificationIdParamsDto): Promise<NotificationDto> {
    return this.notifications.markRead(request.user!.userId, params.id);
  }
}
