import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
type Work = () => Promise<void>;
@Injectable()
export class AuthMailQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(AuthMailQueueService.name);
  private readonly queue: Work[] = [];
  private readonly active = new Set<Promise<void>>();
  private readonly idleWaiters: (() => void)[] = [];
  private reserved = 0;
  private closing = false;
  async schedule(prepare: () => Promise<Work | undefined>): Promise<void> {
    if (this.closing || this.reserved + this.queue.length + this.active.size >= 30) throw new ServiceUnavailableException('Authentication mail is temporarily unavailable');
    this.reserved++;
    try {
      const work = await prepare();
      if (this.closing) throw new ServiceUnavailableException('Authentication mail is temporarily unavailable');
      if (work) { this.queue.push(work); setImmediate(() => this.pump()); }
    } finally { this.reserved--; this.notifyIdle(); }
  }
  private pump(): void {
    while (!this.closing && this.queue.length && this.active.size < 4) {
      const work = this.queue.shift()!;
      const running = work().catch(() => { this.logger.error('Authentication email delivery failed'); }).finally(() => {
        this.active.delete(running); this.pump(); this.notifyIdle();
      });
      this.active.add(running);
    }
    this.notifyIdle();
  }
  private notifyIdle(): void {
    if (!this.reserved && !this.queue.length && !this.active.size) this.idleWaiters.splice(0).forEach((resolve) => resolve());
  }
  whenIdle(): Promise<void> {
    if (!this.reserved && !this.queue.length && !this.active.size) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }
  async onModuleDestroy(): Promise<void> { this.closing = true; this.queue.length = 0; await Promise.allSettled([...this.active]); this.notifyIdle(); }
}
