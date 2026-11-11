import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, QueryFilter, Types } from 'mongoose';
import { MarkAllReadDto, NotificationDto, NotificationPageDto } from './dto/notification-response.dto';
import { NotificationEmailOutboxService } from './notification-email-outbox.service';
import { NotificationType } from './notification-type.enum';
import { Notification, NotificationDocument } from './schemas/notification.schema';
import { NotificationEvent, NotificationEventDocument } from './schemas/notification-event.schema';

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
export class NotificationsService implements OnModuleInit {
  constructor(@InjectModel(Notification.name) private readonly notifications: Model<NotificationDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly emailOutbox: NotificationEmailOutboxService,
    @InjectModel(NotificationEvent.name) private readonly events: Model<NotificationEventDocument>) {}

  async onModuleInit(): Promise<void> { await this.events.init(); }

  /** No external delivery here: this row commits with the booking/refund/schedule mutation. */
  async stage(input: NotificationInput, key: string, session: ClientSession): Promise<void> {
    await this.events.updateOne({ key }, { $setOnInsert: {
      key, userId: new Types.ObjectId(input.userId), type: input.type, message: input.message,
    } }, { upsert: true, session, runValidators: true }).exec();
  }

  /** Inbox, SMTP job and event consumption commit together; failure leaves the event retryable. */
  async deliver(key: string): Promise<void> {
    await this.connection.transaction(async (session) => {
      const event = await this.events.findOneAndDelete({ key }, { session }).exec();
      if (!event) return;
      await this.notify({ userId: event.userId.toString(), type: event.type, message: event.message }, session);
    });
  }

  async processEvents(limit = 25): Promise<void> {
    const events = await this.events.find().sort({ createdAt: 1, _id: 1 }).limit(limit).exec();
    for (const event of events) await this.deliver(event.key);
  }

  /** GEN-01: optional session joins an atomic action; other callers retain their failure policy. */
  async notify(input: NotificationInput, session?: ClientSession): Promise<void> {
    await this.notifyMany([input.userId], input.type, input.message, session);
  }

  /** GEN-01: the same notification for several users, e.g. everyone affected by a provider deactivation (ACC-15). */
  async notifyMany(userIds: string[], type: NotificationInput['type'], message: string, session?: ClientSession): Promise<void> {
    if (!Object.values(NotificationType).includes(type as NotificationType)) {
      throw new Error(`Unknown notification type: ${String(type)}`);
    }
    if (userIds.some((userId) => typeof userId !== 'string' || !OBJECT_ID.test(userId))) {
      throw new Error('Notifications need valid user IDs');
    }
    const unique = [...new Set(userIds.map((userId) => userId.toLowerCase()))];
    if (unique.length === 0) return;
    const write = async (activeSession: ClientSession): Promise<void> => {
      const created = await this.notifications.insertMany(unique.map((userId) => ({
        userId: new Types.ObjectId(userId), type, message,
      })), { session: activeSession, ordered: true });
      await this.emailOutbox.enqueueNotifications(created, activeSession);
    };
    if (session) await write(session);
    else await this.connection.transaction(write);
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
