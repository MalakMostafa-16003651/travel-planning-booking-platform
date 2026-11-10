import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BookingStatus } from '../src/common/enums/booking-status.enum';
import { FlightBookingsService } from '../src/flight-bookings/flight-bookings.service';
import { HotelBookingsService } from '../src/hotel-bookings/hotel-bookings.service';
import { FlightBookingLookupAdapter, HotelBookingLookupAdapter, localDate } from '../src/itineraries/adapters/booking-lookup.adapters';
import { minorToMajor } from '../src/itineraries/itinerary.rules';

describe('ITN-27 linked bookings (no database)', () => {
  it('converts PAY-04 minor units using the currency decimals', () => {
    assert.equal(minorToMajor(25050, 'USD'), 250.5);
    assert.equal(minorToMajor(1, 'USD'), 0.01);
    assert.equal(minorToMajor(1500, 'JPY'), 1500);
  });

  it("maps HotelBookingsService.getMine onto the itinerary's booking shape", async () => {
    const calls: [string, string][] = [];
    const service = {
      async getMine(hotelBookingId: string, userId: string) {
        calls.push([hotelBookingId, userId]);
        return {
          status: BookingStatus.CONFIRMED, totalPrice: 25050, currency: 'USD', bookingReference: 'HB-1',
          hotelName: 'Nile Hotel', checkIn: '2026-12-20', checkOut: '2026-12-22', nights: 2,
        };
      },
    } as unknown as HotelBookingsService;
    const booking = await new HotelBookingLookupAdapter(service).getOwnBooking('b1', 'u1');
    assert.deepEqual(calls, [['b1', 'u1']]);
    assert.deepEqual(booking, {
      status: BookingStatus.CONFIRMED, amountMinor: 25050, currency: 'USD', bookingReference: 'HB-1',
      label: 'Nile Hotel', startDate: '2026-12-20', endDate: '2026-12-22',
    });
  });

  it('omits a missing booking reference (PENDING hotel bookings have none)', async () => {
    const service = {
      async getMine() {
        return { status: BookingStatus.PENDING, totalPrice: 100, currency: 'USD', hotelName: 'H', checkIn: '2026-12-20', checkOut: '2026-12-21', nights: 1 };
      },
    } as unknown as HotelBookingsService;
    const booking = await new HotelBookingLookupAdapter(service).getOwnBooking('b', 'u');
    assert.equal('bookingReference' in booking, false);
  });

  it('takes the local calendar date of a departure in its own time zone', () => {
    assert.equal(localDate(new Date('2026-12-20T23:30:00Z'), 'Africa/Cairo'), '2026-12-21');
    assert.equal(localDate(new Date('2026-12-21T03:00:00Z'), 'America/New_York'), '2026-12-20');
    assert.equal(localDate(new Date('2026-12-20T12:00:00Z'), 'UTC'), '2026-12-20');
  });

  it("maps FlightBookingsService.getMine onto the itinerary's booking shape, using the first departure", async () => {
    const calls: [string, string][] = [];
    const segment = (flightNumber: string, from: string, to: string, departureAt: string, departureTimeZone: string) =>
      ({ flightNumber, departureAirportCode: from, arrivalAirportCode: to, departureAt: new Date(departureAt), departureTimeZone });
    const service = {
      async getMine(flightBookingId: string, userId: string) {
        calls.push([flightBookingId, userId]);
        return {
          status: BookingStatus.CONFIRMED, totalAmount: 40000, currency: 'USD', bookingReference: 'FB-1',
          // Stored out of order on purpose: the outbound leg departs 23:30 UTC = 01:30 next day in Cairo.
          segments: [
            segment('BA154', 'LHR', 'CAI', '2026-12-27T10:00:00Z', 'Europe/London'),
            segment('MS777', 'CAI', 'LHR', '2026-12-20T23:30:00Z', 'Africa/Cairo'),
          ],
        };
      },
    } as unknown as FlightBookingsService;
    const booking = await new FlightBookingLookupAdapter(service).getOwnBooking('f1', 'u1');
    assert.deepEqual(calls, [['f1', 'u1']]);
    assert.deepEqual(booking, {
      status: BookingStatus.CONFIRMED, amountMinor: 40000, currency: 'USD', bookingReference: 'FB-1',
      label: 'MS777 CAI-LHR, BA154 LHR-CAI', startDate: '2026-12-21',
    });
  });
});
