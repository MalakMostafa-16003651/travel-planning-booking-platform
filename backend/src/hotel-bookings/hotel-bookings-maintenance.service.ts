import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { HotelBookingsService } from './hotel-bookings.service';

const SWEEP_INTERVAL_MS = 60 * 1000;

/** Automated reservation work, every minute. Each step is a conditional write, so several servers are safe. */
@Injectable()
export class HotelBookingsMaintenanceService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(HotelBookingsMaintenanceService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly bookings: HotelBookingsService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.bookings.expireOverdueHolds();
      await this.bookings.completeFinishedStays();
      await this.bookings.retryDueRefunds();
    } catch {
      this.logger.error('Hotel booking maintenance failed; it will run again');
    } finally {
      this.running = false;
    }
  }
}
