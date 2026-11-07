import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType } from '../notification-type.enum';

export class NotificationDto {
  @ApiProperty() notificationId!: string;
  @ApiProperty({ enum: NotificationType }) type!: NotificationType;
  @ApiProperty() message!: string;
  @ApiProperty() isRead!: boolean;
  @ApiPropertyOptional({ type: Date, nullable: true }) readAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

export class NotificationPageDto {
  @ApiProperty({ type: NotificationDto, isArray: true }) items!: NotificationDto[];
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 10 }) pageSize!: number;
  @ApiProperty({ example: 3 }) total!: number;
  @ApiProperty({ example: 2, description: 'Unread notifications in the whole inbox, not just this page.' }) unreadCount!: number;
}

export class UnreadCountDto {
  @ApiProperty({ example: 2 }) unreadCount!: number;
}

export class MarkAllReadDto {
  @ApiProperty({ example: 2, description: 'How many unread notifications were marked as read.' }) updatedCount!: number;
}
