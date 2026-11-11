import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { registerPdfFonts, writePdfText } from '../common/pdf-text';
import { FlightSeatSelectionDto } from './dto/select-flight-seats.dto';
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
  generate(booking: FlightBooking, seats: FlightSeatSelectionDto[] = []): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const document = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);
      registerPdfFonts(document);
      const text = (value: string, size = 12) => { document.fontSize(size); writePdfText(document, value); };

      text('Flight e-ticket', 20);
      document.moveDown(0.5); text(`Booking reference: ${booking.bookingReference}`);
      text(`Status: ${booking.status}`);

      document.moveDown(); text('Flights', 14);
      for (const segment of booking.segments) {
        document.moveDown(0.5); text(`${segment.flightNumber}: ${segment.departureAirportCode} to ${segment.arrivalAirportCode} (${segment.cabinClass})`);
        text(`Departs: ${localTime(segment.departureAt, segment.departureTimeZone)}`);
        text(`Arrives: ${localTime(segment.arrivalAt, segment.arrivalTimeZone)}`);
      }

      document.moveDown(); text('Passengers', 14);
      for (const passenger of booking.passengers) {
        const bags = passenger.extraBags > 0 ? `, ${passenger.extraBags} extra bag(s)` : '';
        document.moveDown(0.5); text(`${passenger.fullName} (${passenger.type}), ID ${maskedDocument(passenger.documentNumber)}${bags}`);
      }

      if (seats.length) {
        document.moveDown(); text('Selected seats', 14);
        for (const seat of seats) {
          const segment = booking.segments.find(row => row.flightId.toString() === seat.flightId);
          const passenger = booking.passengers.find(row => row._id.toString() === seat.passengerId);
          if (segment && passenger) text(segment.flightNumber + ' - ' + passenger.fullName + ': seat ' + seat.seatNumber);
        }
      }
      document.moveDown(); text(`Total paid: ${(booking.totalAmount / 100).toFixed(2)} ${booking.currency}`);
      document.end();
    });
  }
}
