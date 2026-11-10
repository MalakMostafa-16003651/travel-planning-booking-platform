import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { BookingStatus } from '../src/common/enums/booking-status.enum';
import { HotelBookingsService } from '../src/hotel-bookings/hotel-bookings.service';
import { HotelBookingLookupAdapter, PendingFlightBookingLookupAdapter } from '../src/itineraries/adapters/booking-lookup.adapters';
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

  it('reports flight linking as not available until Person 4 confirms', async () => {
    await assert.rejects(new PendingFlightBookingLookupAdapter().getOwnBooking(), ServiceUnavailableException);
  });
});
