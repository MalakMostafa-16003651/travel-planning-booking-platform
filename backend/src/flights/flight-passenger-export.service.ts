import { Injectable } from '@nestjs/common';
import { csvRow } from './csv.util';
import { FlightsService } from './flights.service';

/**
 * FLT-29: passenger list as CSV. The airline/ownership check is done by
 * FlightsService.listOwnFlightBookings, so another airline's flight is "not found" here too.
 */
@Injectable()
export class FlightPassengerExportService {
  constructor(private readonly flights: FlightsService) {}

  /** One row per booking; passenger names joined with "; ". Passport numbers are never included. */
  async exportCsv(moderatorId: string, flightId: string): Promise<{ fileName: string; csv: string }> {
    const rows = [csvRow(['Booking Reference', 'Passenger Names', 'Cabin', 'Seats', 'Status'])];
    let page = 1;
    for (;;) {
      const result = await this.flights.listOwnFlightBookings(moderatorId, flightId, page);
      for (const item of result.items) {
        rows.push(csvRow([item.bookingReference ?? '', item.passengerNames.join('; '), item.cabinClass ?? '', item.seatCount, item.status]));
      }
      if (result.items.length === 0 || page * result.pageSize >= result.total) break;
      page += 1;
    }
    return { fileName: `flight-${flightId}-passengers.csv`, csv: rows.join('\r\n') };
  }
}
