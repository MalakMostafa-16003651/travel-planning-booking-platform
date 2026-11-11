import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NotificationEmailOutboxService } from './notification-email-outbox.service';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationEmailWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationEmailWorkerService.name);
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  constructor(private readonly outbox: NotificationEmailOutboxService, private readonly notifications: NotificationsService) {}
  onModuleInit(): void {
    this.timer = setInterval(() => {
      if (this.active) return;
      this.active = this.process()
        .catch(() => { this.logger.error('Notification email worker could not process its queue'); })
        .finally(() => { this.active = undefined; });
    }, 15_000);
    this.timer.unref();
  }
  private async process(): Promise<void> {
    try { await this.notifications.processEvents(); }
    catch { this.logger.error('Business notifications remain queued for retry'); }
    await this.outbox.processBatch(1);
  }
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.active;
  }
}
