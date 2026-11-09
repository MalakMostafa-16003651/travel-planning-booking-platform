import 'reflect-metadata';
import { ConflictException, NotFoundException } from '@nestjs/common';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Types } from 'mongoose';
import { BookingStatus } from '../src/common/enums/booking-status.enum';
import { MongoFlightInventoryAdapter } from '../src/flight-bookings/adapters/mongo-flight-inventory.adapter';
import { FlightBookingsService } from '../src/flight-bookings/flight-bookings.service';
import { HotelBookingsService } from '../src/hotel-bookings/hotel-bookings.service';
import { BookingPaymentsAdapter } from '../src/payments/adapters/booking-payments.adapter';
import { BookingsAdapter } from '../src/payments/adapters/bookings.adapter';
import { RefundStatus } from '../src/payments/payment-status.enum';
import { PaymentsService } from '../src/payments/payments.service';
import { RefundsService } from '../src/payments/refunds.service';

// Unit tests with hand-written fakes: no database and no Stripe. The e2e suites cover the real modules.

const userId = new Types.ObjectId();
const hotelBookingId = new Types.ObjectId();
const paymentId = new Types.ObjectId().toString();
const holdExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

/** A PENDING hotel reservation as Person 6's HotelBookingsService.getMine returns it. */
function hotelBooking() {
  return {
    _id: hotelBookingId,
    userId,
    status: BookingStatus.PENDING,
    totalPrice: 45050, // 450.50 USD in minor units.
    currency: 'USD',
    holdExpiresAt,
    policySnapshot: {
      cancellationTiers: [{ daysBeforeCheckIn: 7, refundPercentage: 100 }, { daysBeforeCheckIn: 1, refundPercentage: 50 }],
      checkInTime: '14:00',
      checkOutTime: '12:00',
    },
  };
}

type Calls = { confirm: string[][]; failed: string[][] };

/** Person 6's service: getMine always; the two payment hooks only when `withHooks` (after the HTL-17 PR). */
function fakeHotelBookings(options: { withHooks: boolean; getMineError?: Error; confirmError?: Error }) {
  const calls: Calls = { confirm: [], failed: [] };
  const service: Record<string, unknown> = {
    async getMine(id: string, owner: string) {
      if (options.getMineError) throw options.getMineError;
      if (id !== hotelBookingId.toString() || owner !== userId.toString()) throw new NotFoundException('Hotel booking not found');
      return hotelBooking();
    },
  };
  if (options.withHooks) {
    service.confirmPaidBooking = async (...args: string[]) => {
      calls.confirm.push(args);
      if (options.confirmError) throw options.confirmError;
    };
    service.markPaymentFailed = async (...args: string[]) => {
      calls.failed.push(args);
    };
  }
  return { service: service as unknown as HotelBookingsService, calls };
}

function fakeFlightBookings(options: { confirmError?: Error } = {}) {
  const confirmed: string[][] = [];
  const service = {
    async getMine() {
      throw new NotFoundException('Flight booking not found');
    },
    async confirmPaidBooking(...args: string[]) {
      confirmed.push(args);
      if (options.confirmError) throw options.confirmError;
    },
  };
  return { service: service as unknown as FlightBookingsService, confirmed };
}

function adapter(hotels: HotelBookingsService, flights = fakeFlightBookings().service) {
  return new BookingsAdapter(flights, hotels, {} as MongoFlightInventoryAdapter);
}

describe('PAY-01/PAY-02 BookingsAdapter: hotel reservations', () => {
  it('maps a hotel reservation to a payable booking in major units with the accepted hotel policies', async () => {
    const { service } = fakeHotelBookings({ withHooks: true });
    const booking = await adapter(service).getBooking('hotel', hotelBookingId.toString(), userId.toString());
    assert.deepEqual(booking, {
      bookingId: hotelBookingId.toString(),
      userId: userId.toString(),
      status: BookingStatus.PENDING,
      totalPrice: 450.5,
      checkoutReady: true,
      currency: 'USD',
      policies: {
        cancellation: { tiers: [{ daysBeforeCheckIn: 7, refundPercentage: 100 }, { daysBeforeCheckIn: 1, refundPercentage: 50 }] },
        checkInOut: { checkInTime: '14:00', checkOutTime: '12:00' },
      },
      holdExpiresAt,
    });
  });

  it('marks hotel checkout unavailable for missing or non-callable lifecycle hooks without hiding policies', async () => {
    for (const missing of ['both', 'confirmPaidBooking', 'markPaymentFailed']) {
      const { service } = fakeHotelBookings({ withHooks: missing !== 'both' });
      if (missing !== 'both') (service as unknown as Record<string, unknown>)[missing] = 'not callable';
      const booking = await adapter(service).getBooking('hotel', hotelBookingId.toString(), userId.toString());
      assert.equal(booking?.checkoutReady, false);
      assert.equal(booking?.totalPrice, 450.5);
      assert.ok(booking?.policies.cancellation);
    }
  });
  it("returns null for an unknown reservation or another user's reservation", async () => {
    const { service } = fakeHotelBookings({ withHooks: true });
    assert.equal(await adapter(service).getBooking('hotel', new Types.ObjectId().toString(), userId.toString()), null);
    assert.equal(await adapter(service).getBooking('hotel', hotelBookingId.toString(), new Types.ObjectId().toString()), null);
  });

  it('does not hide unexpected errors such as a database failure', async () => {
    const { service } = fakeHotelBookings({ withHooks: true, getMineError: new Error('database down') });
    await assert.rejects(adapter(service).getBooking('hotel', hotelBookingId.toString(), userId.toString()), /database down/);
  });

  it('confirms through Person 6 confirmPaidBooking with the booking and payment ids', async () => {
    const { service, calls } = fakeHotelBookings({ withHooks: true });
    assert.equal(await adapter(service).markConfirmed('hotel', hotelBookingId.toString(), paymentId), true);
    assert.deepEqual(calls.confirm, [[hotelBookingId.toString(), paymentId]]);
  });

  it('reports "not confirmed" when the hold ended or the reservation is gone, so Payments refunds it', async () => {
    for (const error of [new ConflictException('hold ended'), new NotFoundException('gone')]) {
      const { service } = fakeHotelBookings({ withHooks: true, confirmError: error });
      assert.equal(await adapter(service).markConfirmed('hotel', hotelBookingId.toString(), paymentId), false);
    }
    const { service } = fakeHotelBookings({ withHooks: true, confirmError: new Error('database down') });
    await assert.rejects(adapter(service).markConfirmed('hotel', hotelBookingId.toString(), paymentId), /database down/);
  });

  it('never confirms before Person 6 adds confirmPaidBooking (the payment is then refunded)', async () => {
    const { service } = fakeHotelBookings({ withHooks: false });
    assert.equal(await adapter(service).markConfirmed('hotel', hotelBookingId.toString(), paymentId), false);
    // A failed payment is a no-op without the hook.
    await adapter(service).markPaymentFailed('hotel', hotelBookingId.toString(), paymentId);
  });

  it('passes a failed payment to Person 6 for hotels only', async () => {
    const { service, calls } = fakeHotelBookings({ withHooks: true });
    await adapter(service).markPaymentFailed('hotel', hotelBookingId.toString(), paymentId);
    await adapter(service).markPaymentFailed('flight', hotelBookingId.toString(), paymentId);
    assert.deepEqual(calls.failed, [[hotelBookingId.toString(), paymentId]]);
  });
});

describe('PAY-01 BookingsAdapter: flight bookings still work', () => {
  it('confirms flights through Person 4 and never calls the hotel module', async () => {
    const hotels = fakeHotelBookings({ withHooks: true });
    const flights = fakeFlightBookings();
    assert.equal(await adapter(hotels.service, flights.service).markConfirmed('flight', 'f1', paymentId), true);
    assert.deepEqual(flights.confirmed, [['f1', paymentId]]);
    assert.deepEqual(hotels.calls.confirm, []);
  });

  it('returns false for a flight hold that ended, and null for an unknown flight booking', async () => {
    const hotels = fakeHotelBookings({ withHooks: true });
    const flights = fakeFlightBookings({ confirmError: new ConflictException('hold ended') });
    assert.equal(await adapter(hotels.service, flights.service).markConfirmed('flight', 'f1', paymentId), false);
    assert.equal(await adapter(hotels.service, flights.service).getBooking('flight', 'f1', userId.toString()), null);
  });
});

describe('PAY-01/PAY-03 BookingPaymentsAdapter: calls from the booking modules', () => {
  function setup(latestRefund: unknown = null) {
    const calls: { cancel: unknown[][]; refund: unknown[]; latest: unknown[][] } = { cancel: [], refund: [], latest: [] };
    const payments = {
      async cancelPendingPayment(...args: unknown[]) {
        calls.cancel.push(args);
      },
    } as unknown as PaymentsService;
    const refunds = {
      async refundCancelledBooking(input: unknown) {
        calls.refund.push(input);
        return { _id: new Types.ObjectId('0123456789abcdef01234567') };
      },
      async findLatestForBooking(...args: unknown[]) {
        calls.latest.push(args);
        return latestRefund;
      },
    } as unknown as RefundsService;
    return { adapter: new BookingPaymentsAdapter(payments, refunds), calls };
  }

  it('cancels the open PaymentIntent of an expired hotel or flight hold', async () => {
    const { adapter: bookingPayments, calls } = setup();
    await bookingPayments.cancelPendingPayment({ bookingType: 'HOTEL', bookingId: 'h1' });
    await bookingPayments.cancelPendingPayment({ bookingType: 'FLIGHT', bookingId: 'f1' });
    assert.deepEqual(calls.cancel, [['hotel', 'h1'], ['flight', 'f1']]);
  });

  it('refunds a cancelled hotel reservation, converting minor units to major units', async () => {
    const { adapter: bookingPayments, calls } = setup();
    const result = await bookingPayments.createRefund({ bookingType: 'HOTEL', bookingId: 'h1', amount: 22525, reason: 'Hotel reservation cancelled by the user' });
    assert.deepEqual(result, { refundId: '0123456789abcdef01234567' });
    assert.deepEqual(calls.refund, [{ bookingType: 'hotel', bookingId: 'h1', amount: 225.25, reason: 'Hotel reservation cancelled by the user' }]);
  });

  it('shows the latest refund status of a booking in minor units, or null without a refund', async () => {
    const refundId = new Types.ObjectId();
    const withRefund = setup({ _id: refundId, status: RefundStatus.REFUNDED, amount: 225.25, currency: 'USD' });
    assert.deepEqual(await withRefund.adapter.getRefundStatus({ bookingType: 'HOTEL', bookingId: 'h1' }), {
      refundId: refundId.toString(), status: RefundStatus.REFUNDED, amount: 22525, currency: 'USD',
    });
    assert.deepEqual(withRefund.calls.latest, [['hotel', 'h1']]);
    assert.equal(await setup(null).adapter.getRefundStatus({ bookingType: 'FLIGHT', bookingId: 'f1' }), null);
  });
});
