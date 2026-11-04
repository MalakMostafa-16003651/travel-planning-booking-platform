import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { FlightBooking } from './schemas/flight-booking.schema';

function localTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date);
}

function maskedDocument(documentNumber: string): string {
  return `${'*'.repeat(Math.max(documentNumber.length - 4, 0))}${documentNumber.slice(-4)}`;
}

/** FLT-23 e-ticket. Times use each airport's local zone (GEN-06). */
@Injectable()
export class ETicketService {
  generate(booking: FlightBooking): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const document = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);

      document.fontSize(20).text('Flight e-ticket');
      document.moveDown(0.5).fontSize(12).text(`Booking reference: ${booking.bookingReference}`);
      document.text(`Status: ${booking.status}`);

      document.moveDown().fontSize(14).text('Flights');
      for (const segment of booking.segments) {
        document.moveDown(0.5).fontSize(12).text(`${segment.flightNumber}: ${segment.departureAirportCode} to ${segment.arrivalAirportCode} (${segment.cabinClass})`);
        document.text(`Departs: ${localTime(segment.departureAt, segment.departureTimeZone)}`);
        document.text(`Arrives: ${localTime(segment.arrivalAt, segment.arrivalTimeZone)}`);
      }

      document.moveDown().fontSize(14).text('Passengers');
      for (const passenger of booking.passengers) {
        const bags = passenger.extraBags > 0 ? `, ${passenger.extraBags} extra bag(s)` : '';
        document.moveDown(0.5).fontSize(12).text(`${passenger.fullName} (${passenger.type}), ID ${maskedDocument(passenger.documentNumber)}${bags}`);
      }

      document.moveDown().fontSize(12).text(`Total paid: ${(booking.totalAmount / 100).toFixed(2)} ${booking.currency}`);
      document.end();
    });
  }
}
