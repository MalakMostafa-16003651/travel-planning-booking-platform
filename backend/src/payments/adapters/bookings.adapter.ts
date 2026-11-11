import { FlightBookingChangesService } from '../../flight-bookings/flight-booking-changes.service';
import { ConflictException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MongoFlightInventoryAdapter } from '../../flight-bookings/adapters/mongo-flight-inventory.adapter';
import { FlightBookingsService } from '../../flight-bookings/flight-bookings.service';
import { HotelBookingsService } from '../../hotel-bookings/hotel-bookings.service';
import { BookingsPort, BookingType, PayableBooking } from '../bookings-port';

/**
 * The two payment calls Person 6 adds to HotelBookingsService in the HTL-17 PR (hotel booking contract,
 * questions O1-O3). Same meaning as the flight ones:
 * - confirmPaidBooking: PENDING -> CONFIRMED, safe to repeat for the same paymentId, 409 when the hold ended.
 * - markPaymentFailed: no state change, the user can retry until the hold ends.
 */
export interface HotelPaymentHooks {
  confirmPaidBooking(hotelBookingId: string, paymentId: string): Promise<unknown>;
  markPaymentFailed(hotelBookingId: string, paymentId: string): Promise<unknown>;
}

// Not found and "hold ended" mean "not confirmed". Payments then refunds the money in full.
function isNotConfirmable(error: unknown): boolean {
  return error instanceof ConflictException || error instanceof NotFoundException;
}

/**
 * BookingsPort over Person 4's FlightBookingsService and Person 6's HotelBookingsService.
 * Both modules store minor units; Payments works in major units, so amounts are divided by 100.
 */
@Injectable()
export class BookingsAdapter implements BookingsPort {
  private readonly logger = new Logger(BookingsAdapter.name);

  constructor(
    @Inject(forwardRef(() => FlightBookingsService)) private readonly flightBookings: FlightBookingsService,
    @Inject(forwardRef(() => HotelBookingsService)) private readonly hotelBookings: HotelBookingsService,
    private readonly inventory: MongoFlightInventoryAdapter,
    @Inject(forwardRef(() => FlightBookingChangesService)) private readonly changes?: FlightBookingChangesService,
  ) {}

  getBooking(type: BookingType, bookingId: string, userId: string): Promise<PayableBooking | null> {
    if (type === 'flight-change') return this.changes!.payable(bookingId, userId);
    return type === 'flight' ? this.getFlightBooking(bookingId, userId) : this.getHotelBooking(bookingId, userId);
  }

  async markConfirmed(type: BookingType, bookingId: string, paymentId: string): Promise<boolean> {
    try {
      if (type === 'flight-change') { await this.changes!.confirmPaid(bookingId, paymentId); return true; }
      if (type === 'flight') {
        // Idempotent for the same paymentId; throws 409 when the hold has ended.
        await this.flightBookings.confirmPaidBooking(bookingId, paymentId);
        return true;
      }
      const hooks = this.hotelHooks();
      if (!hooks.confirmPaidBooking) {
        // Only until Person 6's HTL-17 PR is merged. The payment is then refunded, never kept.
        this.logger.warn('Hotel booking confirmation is not connected yet');
        return false;
      }
      await hooks.confirmPaidBooking.call(this.hotelBookings, bookingId, paymentId);
      return true;
    } catch (error) {
      if (isNotConfirmable(error)) return false;
      throw error;
    }
  }

  async markPaymentFailed(type: BookingType, bookingId: string, paymentId: string): Promise<void> {
    // Flights: the booking stays PENDING until its hold ends, so the user can retry.
    if (type !== 'hotel') return;
    const hooks = this.hotelHooks();
    await hooks.markPaymentFailed?.call(this.hotelBookings, bookingId, paymentId);
  }

  private async getFlightBooking(bookingId: string, userId: string): Promise<PayableBooking | null> {
    let booking;
    try {
      booking = await this.flightBookings.getMine(bookingId, userId);
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
    // FLT-12: a round trip is cancelled on the outbound airline's tiers.
    const airlineIds = [...new Set(booking.segments.map((segment) => segment.airlineId.toString()))];
    const airlines = await Promise.all(airlineIds.map((airlineId) => this.inventory.getAirlinePolicy(airlineId)));
    const outbound = airlines[0];
    const baggage = [];
    for (const segment of booking.segments) {
      const airline = airlines.find((item) => item?.airlineId === segment.airlineId.toString());
      const cabin = segment.baggageAllowanceCount === undefined || segment.baggageMaxWeightKg === undefined
        ? await this.inventory.getCabin(segment.cabinId.toString()) : null;
      baggage.push({ airlineId: segment.airlineId.toString(), flightId: segment.flightId.toString(),
        cabinId: segment.cabinId.toString(), cabinClass: segment.cabinClass,
        baggageAllowanceCount: segment.baggageAllowanceCount ?? cabin?.baggageAllowanceCount ?? 0,
        baggageMaxWeightKg: segment.baggageMaxWeightKg ?? cabin?.baggageMaxWeightKg ?? null,
        pricePerExtraBag: (airline?.pricePerExtraBag ?? 0) / 100,
        maxExtraBagsPerPassenger: airline?.maxExtraBagsPerPassenger ?? 0 });
    }
    return {
      bookingId: booking._id.toString(),
      userId: booking.userId.toString(),
      status: booking.status,
      totalPrice: booking.totalAmount / 100,
      currency: booking.currency,
      policies: {
        cancellation: {
          tiers: (outbound?.cancellationTiers ?? []).map(({ daysBeforeDeparture, refundPercentage }) => ({ daysBeforeDeparture, refundPercentage })),
        },
        baggage,
      },
      holdExpiresAt: booking.holdExpiresAt,
    };
  }

  /**
   * PAY-02 for hotels: the cancellation tiers and check-in/check-out times copied when the rooms were
   * held (HotelBooking.policySnapshot), so the policy the user accepts is the one applied later (O5).
   */
  private async getHotelBooking(bookingId: string, userId: string): Promise<PayableBooking | null> {
    let booking;
    try {
      // Owner only: another user's reservation is "not found" (ACC-11).
      booking = await this.hotelBookings.getMine(bookingId, userId);
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
    const { cancellationTiers, checkInTime, checkOutTime } = booking.policySnapshot;
    const hooks = this.hotelHooks();
    return {
      bookingId: booking._id.toString(),
      userId: booking.userId.toString(),
      status: booking.status,
      totalPrice: booking.totalPrice / 100,
      checkoutReady: typeof hooks.confirmPaidBooking === 'function' && typeof hooks.markPaymentFailed === 'function',
      currency: booking.currency,
      policies: {
        cancellation: {
          tiers: cancellationTiers.map(({ daysBeforeCheckIn, refundPercentage }) => ({ daysBeforeCheckIn, refundPercentage })),
        },
        checkInOut: { checkInTime, checkOutTime },
      },
      holdExpiresAt: booking.holdExpiresAt,
    };
  }

  // The hooks are optional here so this module works before and after Person 6's PR is merged.
  private hotelHooks(): Partial<HotelPaymentHooks> {
    return this.hotelBookings as unknown as Partial<HotelPaymentHooks>;
  }
}
