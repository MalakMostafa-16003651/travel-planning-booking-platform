import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { FlightsService } from './flights.service';

@Injectable()
export class FlightsMaintenanceService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger(FlightsMaintenanceService.name);
  constructor(private readonly flights: FlightsService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.flights.markDeparted().catch(() => this.logger.error('Could not refresh departed flight statuses'));
    }, 60_000);
    this.timer.unref?.();
    void this.flights.markDeparted().catch(() => this.logger.error('Could not perform initial departed-flight status refresh'));
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
}
