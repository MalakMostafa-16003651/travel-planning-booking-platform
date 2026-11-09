import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { refundAmountFor, refundPercentageFor } from '../flight-bookings/flight-booking.rules';
import { HotelCancellationQuoteDto } from './dto/cancel-hotel-booking.dto';
import { HotelBookingsClock } from './hotel-booking.dates';
import { HotelBooking } from './schemas/hotel-booking.schema';

const QUOTE_TTL_MS = 5 * 60_000;

/** Stateless, purpose-bound consent proof. No new stored fields or environment names. */
@Injectable()
export class HotelCancellationQuotesService {
  private readonly secret: string;
  constructor(config: ConfigService, private readonly clock: HotelBookingsClock) {
    this.secret = config.getOrThrow<string>('JWT_SECRET');
  }

  calculate(booking: HotelBooking) {
    const today = this.clock.today();
    if (booking.status !== BookingStatus.CONFIRMED || booking.checkIn <= today)
      throw new ConflictException('Only Confirmed reservations before the check-in date can be cancelled');
    const daysBeforeCheckIn = Math.round((Date.parse(booking.checkIn + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86_400_000);
    const tiers = booking.policySnapshot.cancellationTiers.map(tier => ({ daysBeforeDeparture: tier.daysBeforeCheckIn, refundPercentage: tier.refundPercentage }));
    const refundPercentage = refundPercentageFor(tiers, daysBeforeCheckIn);
    if (!Number.isSafeInteger(booking.totalPrice) || booking.totalPrice < 0 || !Number.isFinite(refundPercentage)
      || refundPercentage < 0 || refundPercentage > 100 || !Number.isSafeInteger(daysBeforeCheckIn))
      throw new ConflictException('The reservation refund cannot be calculated');
    return { hotelBookingId: booking._id.toString(), totalPrice: booking.totalPrice, currency: booking.currency,
      daysBeforeCheckIn, refundPercentage, refundAmount: refundAmountFor(booking.totalPrice, refundPercentage), today };
  }

  issue(booking: HotelBooking): HotelCancellationQuoteDto {
    const { today: _today, ...quote } = this.calculate(booking);
    const expiresAt = new Date(Date.now() + QUOTE_TTL_MS);
    return { ...quote, expiresAt, quoteToken: expiresAt.getTime() + '.' + this.signature(booking, expiresAt.getTime()) };
  }

  assertValid(booking: HotelBooking, token: string) {
    if (typeof token !== 'string' || !/^\d{13}\.[a-f\d]{64}$/.test(token)) throw new ConflictException('Request a new cancellation quote');
    const [deadline, supplied] = token.split('.');
    const expiresAt = Number(deadline);
    if (expiresAt <= Date.now() || !timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(this.signature(booking, expiresAt), 'hex')))
      throw new ConflictException('Cancellation quote expired or changed; request a new quote');
    return this.calculate(booking);
  }

  private signature(booking: HotelBooking, expiresAt: number): string {
    return createHmac('sha256', this.secret).update(JSON.stringify({ purpose: 'hotel-cancellation-v1',
      userId: booking.userId.toString(), bookingId: booking._id.toString(), updatedAt: booking.updatedAt,
      checkIn: booking.checkIn, policy: booking.policySnapshot.cancellationTiers, quote: this.calculate(booking), expiresAt })).digest('hex');
  }
}