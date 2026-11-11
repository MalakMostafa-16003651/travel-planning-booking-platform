import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NotificationEmailOutboxService } from './notification-email-outbox.service';

@Injectable()
export class NotificationEmailWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationEmailWorkerService.name);
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  constructor(private readonly outbox: NotificationEmailOutboxService) {}
  onModuleInit(): void {
    this.timer = setInterval(() => {
      if (this.active) return;
      this.active = this.outbox.processBatch(1).then(() => undefined)
        .catch(() => { this.logger.error('Notification email worker could not process its queue'); })
        .finally(() => { this.active = undefined; });
    }, 15_000);
    this.timer.unref();
  }
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.active;
  }
}
