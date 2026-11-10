import type { PipelineStage } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import type { BookingType } from './bookings-port';
import { PaymentStatus } from './payment-status.enum';
import { HOLD_EXPIRED_REASON } from './payments.service';

/** One recovery predicate for both booking modules. Gateways/status writes stay in Payments. */
export function expiredBookingPaymentPipeline(type: BookingType, bookingCollection: string, limit: number): PipelineStage[] {
  const field = type === 'flight' ? 'flightBookingId' : 'hotelBookingId';
  return [
    { $match: { bookingType: type, $or: [
      { status: PaymentStatus.PENDING },
      { status: PaymentStatus.FAILED, failureReason: { $ne: HOLD_EXPIRED_REASON } },
      { status: PaymentStatus.SUCCEEDED, bookingConfirmedAt: null, autoRefundedAt: null },
    ] } },
    { $lookup: { from: bookingCollection, localField: field, foreignField: '_id', as: 'booking' } },
    { $match: { 'booking.status': BookingStatus.EXPIRED } },
    { $sort: { updatedAt: 1, _id: 1 } }, { $limit: limit }, { $project: { [field]: 1 } },
  ];
}
