import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MailModule } from '../mail/mail.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { NotificationEmailJob, NotificationEmailJobSchema } from './schemas/notification-email-job.schema';
import { NotificationEmailOutboxService } from './notification-email-outbox.service';
import { NotificationEmailWorkerService } from './notification-email-worker.service';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { Notification, NotificationSchema } from './schemas/notification.schema';
import { NotificationEvent, NotificationEventSchema } from './schemas/notification-event.schema';

@Module({
  imports: [AuthModule, MailModule, MongooseModule.forFeature([{ name: NotificationEvent.name, schema: NotificationEventSchema }, { name: Notification.name, schema: NotificationSchema }, { name: NotificationEmailJob.name, schema: NotificationEmailJobSchema }, { name: User.name, schema: UserSchema }])],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationEmailOutboxService, NotificationEmailWorkerService],
  // GEN-01: other modules import NotificationsModule and call NotificationsService.notify().
  exports: [NotificationsService, NotificationEmailOutboxService],
})
export class NotificationsModule {}
