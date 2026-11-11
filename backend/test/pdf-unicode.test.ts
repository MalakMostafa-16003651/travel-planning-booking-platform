import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Types } from 'mongoose';
import { ETicketService } from '../src/flight-bookings/e-ticket.service';
import { FlightBooking } from '../src/flight-bookings/schemas/flight-booking.schema';
import { pdfText } from './pdf-text-reader';

it('e-tickets embed Unicode names while masking identity documents and retaining seat text', async () => {
  const flightId = new Types.ObjectId(), passengerId = new Types.ObjectId();
  const booking = { bookingReference: 'UNICODE1', status: 'CONFIRMED', totalAmount: 15000, currency: 'USD',
    segments: [{ flightId, flightNumber: 'MS100', departureAirportCode: 'CAI', arrivalAirportCode: 'PEK', cabinClass: 'ECONOMY',
      departureAt: new Date('2027-12-10T08:00:00Z'), arrivalAt: new Date('2027-12-10T19:00:00Z'), departureTimeZone: 'Africa/Cairo', arrivalTimeZone: 'Asia/Shanghai' }],
    passengers: [{ _id: passengerId, fullName: 'أحمد محمد / 张伟 / 日本語 / 한국어 / Zoë García', type: 'ADULT', documentNumber: 'PRIVATE12345678', extraBags: 1 }] } as FlightBooking;
  const pdf = await new ETicketService().generate(booking, [{ flightId: flightId.toString(), passengerId: passengerId.toString(), seatNumber: 9 }]);
  const text = pdfText(pdf);
  for (const value of ['张伟', '日本語', '한국어', 'Zoë García', 'Selected seats', 'seat 9', '5678']) assert.ok(text.includes(value), value);
  for (const letter of 'أحمد') assert.ok(text.includes(letter), 'Arabic glyph ' + letter);
  assert.equal(text.includes('PRIVATE12345678'), false);
});
