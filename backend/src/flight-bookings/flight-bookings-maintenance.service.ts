import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { FlightBookingsService } from './flight-bookings.service';

const SWEEP_INTERVAL_MS = 60 * 1000;

/** Automated booking work. Each step is conditional, so running on several servers is safe. */
@Injectable()
export class FlightBookingsMaintenanceService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FlightBookingsMaintenanceService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly bookings: FlightBookingsService) {}

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
      await this.bookings.completeDepartedBookings();
      await this.bookings.retryDueRefunds();
    } catch {
      this.logger.error('Flight booking maintenance failed; it will run again');
    } finally {
      this.running = false;
    }
  }
}
