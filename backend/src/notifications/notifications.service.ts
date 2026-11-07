import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { MarkAllReadDto, NotificationDto, NotificationPageDto } from './dto/notification-response.dto';
import { NotificationType } from './notification-type.enum';
import { Notification, NotificationDocument } from './schemas/notification.schema';

/** GEN-05: every list uses page size 10. */
export const NOTIFICATIONS_PAGE_SIZE = 10;

const OBJECT_ID = /^[a-f\d]{24}$/i;

/**
 * The shape other modules send. `type` also accepts the plain string values so it matches
 * Person 4's BookingNotificationsPort ('BOOKING_CONFIRMED' | 'BOOKING_CANCELLED') unchanged.
 */
export interface NotificationInput {
  userId: string;
  type: NotificationType | `${NotificationType}`;
  message: string;
}

@Injectable()
export class NotificationsService {
  constructor(@InjectModel(Notification.name) private readonly notifications: Model<NotificationDocument>) {}

  /** GEN-01: creates one notification. Callers should treat a failure as non-fatal. */
  async notify(input: NotificationInput): Promise<void> {
    await this.notifyMany([input.userId], input.type, input.message);
  }

  /** GEN-01: the same notification for several users, e.g. everyone affected by a provider deactivation (ACC-15). */
  async notifyMany(userIds: string[], type: NotificationInput['type'], message: string): Promise<void> {
    if (!Object.values(NotificationType).includes(type as NotificationType)) {
      throw new Error(`Unknown notification type: ${String(type)}`);
    }
    if (userIds.some((userId) => typeof userId !== 'string' || !OBJECT_ID.test(userId))) {
      throw new Error('Notifications need valid user IDs');
    }
    const unique = [...new Set(userIds.map((userId) => userId.toLowerCase()))];
    if (unique.length === 0) return;
    await this.notifications.insertMany(unique.map((userId) => ({
      userId: new Types.ObjectId(userId),
      type,
      message,
    })));
  }

  /** GEN-01: the user's own notifications, newest first, page size 10, with the inbox's unread count. */
  async listOwn(userId: string, options: { page?: number; unreadOnly?: boolean }): Promise<NotificationPageDto> {
    const page = options.page ?? 1;
    const owner = new Types.ObjectId(userId);
    const filter: QueryFilter<Notification> = { userId: owner };
    if (options.unreadOnly) filter.isRead = false;
    const [rows, total, unreadCount] = await Promise.all([
      this.notifications.find(filter).sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * NOTIFICATIONS_PAGE_SIZE).limit(NOTIFICATIONS_PAGE_SIZE).lean().exec(),
      this.notifications.countDocuments(filter).exec(),
      this.countUnread(userId),
    ]);
    return { items: rows.map(toDto), page, pageSize: NOTIFICATIONS_PAGE_SIZE, total, unreadCount };
  }

  /** GEN-01: unread count for the notification badge. */
  countUnread(userId: string): Promise<number> {
    return this.notifications.countDocuments({ userId: new Types.ObjectId(userId), isRead: false }).exec();
  }

  /** GEN-01: marks one of the user's own notifications as read. Another user's notification is 404, so it is not revealed. */
  async markRead(userId: string, notificationId: string): Promise<NotificationDto> {
    const owner = { _id: new Types.ObjectId(notificationId), userId: new Types.ObjectId(userId) };
    // Only an unread notification gets a new readAt; reading it again keeps the first time.
    await this.notifications.updateOne({ ...owner, isRead: false }, { $set: { isRead: true, readAt: new Date() } }).exec();
    const notification = await this.notifications.findOne(owner).lean().exec();
    if (!notification) throw new NotFoundException('Notification not found');
    return toDto(notification);
  }

  /** GEN-01: marks all of the user's unread notifications as read. */
  async markAllRead(userId: string): Promise<MarkAllReadDto> {
    const result = await this.notifications.updateMany(
      { userId: new Types.ObjectId(userId), isRead: false },
      { $set: { isRead: true, readAt: new Date() } },
    ).exec();
    return { updatedCount: result.modifiedCount };
  }
}

function toDto(row: Notification): NotificationDto {
  return {
    notificationId: row._id.toString(),
    type: row.type,
    message: row.message,
    isRead: row.isRead,
    readAt: row.readAt ?? null,
    createdAt: row.createdAt,
  };
}
