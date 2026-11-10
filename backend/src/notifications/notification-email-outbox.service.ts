import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { ClientSession, Model, Types } from 'mongoose';
import { MailService } from '../mail/mail.service';
import { User } from '../users/schemas/user.schema';
import { Notification } from './schemas/notification.schema';
import { NotificationType } from './notification-type.enum';
import { NotificationEmailJob, NotificationEmailKind, NotificationEmailStatus } from './schemas/notification-email-job.schema';

export const NOTIFICATION_EMAIL_MAX_ATTEMPTS = 5;
export const NOTIFICATION_EMAIL_LEASE_MS = 120_000;
const BATCH_SIZE = 10;

const subjects: Record<NotificationType, string> = {
  BOOKING_CONFIRMED: 'Booking confirmed', BOOKING_CANCELLED: 'Booking cancelled', REFUND_ISSUED: 'Refund issued',
  FLIGHT_SCHEDULE_CHANGED: 'Flight schedule changed', ACCOUNT_SUSPENDED: 'Account suspended',
  ACCOUNT_REACTIVATED: 'Account reactivated', PROVIDER_DEACTIVATED: 'Provider deactivated', PROVIDER_REACTIVATED: 'Provider reactivated',
};

type NotificationForEmail = Pick<Notification, '_id' | 'userId' | 'type' | 'message'>;
type EmailJobInput = Pick<NotificationEmailJob, 'userId' | 'kind' | 'dedupeKey' | 'message'> &
  Partial<Pick<NotificationEmailJob, 'notificationId' | 'notificationType'>>;

/** GEN-01-B: private durable outbox. SMTP is called only by the separate worker after commit. */
@Injectable()
export class NotificationEmailOutboxService implements OnModuleInit {
  private readonly logger = new Logger(NotificationEmailOutboxService.name);
  constructor(
    @InjectModel(NotificationEmailJob.name) private readonly jobs: Model<NotificationEmailJob>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly mail: MailService,
  ) {}

  async onModuleInit(): Promise<void> { await this.jobs.init(); }

  async enqueueNotifications(notifications: NotificationForEmail[], session: ClientSession): Promise<void> {
    await this.enqueue(notifications.map((row) => ({
      userId: row.userId, notificationId: row._id, kind: NotificationEmailKind.NOTIFICATION,
      notificationType: row.type, dedupeKey: 'notification:' + row._id.toString(), message: row.message,
    })), session);
  }

  async enqueueModeratorInvitation(userId: string, providerName: string, session: ClientSession): Promise<void> {
    await this.enqueue([{
      userId: new Types.ObjectId(userId), kind: NotificationEmailKind.MODERATOR_INVITATION,
      dedupeKey: 'moderator-invitation:' + userId.toLowerCase(),
      message: 'An administrator created your Travel Planning moderator account for ' + providerName +
        '. Sign in with the temporary password provided separately by your administrator. You must change it at first login.',
    }], session);
  }

  private async enqueue(rows: EmailJobInput[], session: ClientSession): Promise<void> {
    if (!rows.length) return;
    const now = new Date();
    await this.jobs.bulkWrite(rows.map((row) => ({ updateOne: {
      filter: { dedupeKey: row.dedupeKey },
      update: { $setOnInsert: { ...row, status: NotificationEmailStatus.PENDING, attempts: 0,
        availableAt: now, createdAt: now, updatedAt: now, leaseUntil: null, leaseToken: null, sentAt: null, lastFailureAt: null } },
      upsert: true, timestamps: false,
    } })), { session, ordered: true });
  }

  /** At-least-once SMTP delivery: a crash after SMTP acceptance can precede the SENT write. */
  async processBatch(limit = BATCH_SIZE): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > BATCH_SIZE) throw new Error('Invalid notification email batch size');
    if (!this.mail.isConfigured()) return 0;
    const expired = new Date();
    await this.jobs.updateMany({ attempts: { $gte: NOTIFICATION_EMAIL_MAX_ATTEMPTS }, $or: [
      { status: NotificationEmailStatus.PENDING },
      { status: NotificationEmailStatus.PROCESSING, leaseUntil: { $lte: expired } },
    ] }, { $set: { status: NotificationEmailStatus.FAILED, leaseToken: null, leaseUntil: null, lastFailureAt: expired } }).exec();
    let processed = 0;
    for (; processed < limit; processed++) {
      const now = new Date();
      const leaseToken = randomUUID();
      const job = await this.jobs.findOneAndUpdate({ attempts: { $lt: NOTIFICATION_EMAIL_MAX_ATTEMPTS }, $or: [
        { status: NotificationEmailStatus.PENDING, availableAt: { $lte: now } },
        { status: NotificationEmailStatus.PROCESSING, leaseUntil: { $lte: now } },
      ] }, { $set: { status: NotificationEmailStatus.PROCESSING, leaseToken,
        leaseUntil: new Date(now.getTime() + NOTIFICATION_EMAIL_LEASE_MS) }, $inc: { attempts: 1 } },
      { returnDocument: 'after', sort: { availableAt: 1, createdAt: 1, _id: 1 } }).lean().exec();
      if (!job) break;
      const owned = { _id: job._id, status: NotificationEmailStatus.PROCESSING, leaseToken };
      try {
        const user = await this.users.findById(job.userId).select('email').lean().exec();
        if (!user) {
          await this.jobs.updateOne(owned, { $set: { status: NotificationEmailStatus.FAILED,
            leaseToken: null, leaseUntil: null, lastFailureAt: new Date() } }).exec();
          continue;
        }
        const subject = job.kind === NotificationEmailKind.MODERATOR_INVITATION
          ? 'Moderator invitation' : subjects[job.notificationType!];
        await this.mail.send({ to: user.email, subject: 'Travel Planning: ' + subject,
          text: job.message + '\n\nSign in to Travel Planning for account details.' });
        await this.jobs.updateOne(owned, { $set: { status: NotificationEmailStatus.SENT,
          sentAt: new Date(), leaseToken: null, leaseUntil: null } }).exec();
      } catch {
        await this.jobs.updateOne(owned, { $set: {
          status: job.attempts >= NOTIFICATION_EMAIL_MAX_ATTEMPTS ? NotificationEmailStatus.FAILED : NotificationEmailStatus.PENDING,
          availableAt: new Date(Date.now() + 30_000 * 2 ** (job.attempts - 1)),
          lastFailureAt: new Date(), leaseToken: null, leaseUntil: null,
        } }).exec();
        // No recipient, message, credentials or provider diagnostics enter logs.
        this.logger.error('Notification email delivery failed; retry state recorded');
      }
    }
    return processed;
  }
}
