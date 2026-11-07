import { ConflictException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { MongoFlightInventoryAdapter } from '../../flight-bookings/adapters/mongo-flight-inventory.adapter';
import { FlightBookingsService } from '../../flight-bookings/flight-bookings.service';
import { BookingsPort, BookingType, PayableBooking } from '../bookings-port';

/**
 * BookingsPort over Person 4's exported FlightBookingsService. Hotel bookings
 * (Person 6) do not exist yet, so a hotel booking is always "not found".
 */
@Injectable()
export class FlightBookingsAdapter implements BookingsPort {
  constructor(
    @Inject(forwardRef(() => FlightBookingsService)) private readonly flightBookings: FlightBookingsService,
    private readonly inventory: MongoFlightInventoryAdapter,
  ) {}

  async getBooking(type: BookingType, bookingId: string, userId: string): Promise<PayableBooking | null> {
    if (type !== 'flight') return null;
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
        baggage: airlines.filter((airline) => airline !== null).map((airline) => ({
          airlineId: airline.airlineId,
          pricePerExtraBag: airline.pricePerExtraBag / 100,
          maxExtraBagsPerPassenger: airline.maxExtraBagsPerPassenger,
        })),
      },
      holdExpiresAt: booking.holdExpiresAt,
    };
  }

  async markConfirmed(type: BookingType, bookingId: string, paymentId: string): Promise<boolean> {
    if (type !== 'flight') return false;
    try {
      // Idempotent for the same paymentId; throws 409 when the hold has ended.
      await this.flightBookings.confirmPaidBooking(bookingId, paymentId);
      return true;
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) return false;
      throw error;
    }
  }

  async markPaymentFailed(): Promise<void> {
    // The booking stays PENDING until its hold ends, so the user can retry.
  }
}
