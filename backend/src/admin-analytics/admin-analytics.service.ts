import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { Airline } from '../airlines/schemas/airline.schema';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { Payment } from '../payments/schemas/payment.schema';
import { PaymentStatus, RefundStatus } from '../payments/payment-status.enum';
import { PLATFORM_CURRENCY } from '../flight-bookings/flight-booking.rules';
import { allocateMinor } from './allocate-minor';
import { AnalyticsPageDto, AnalyticsQueryDto, ProviderAnalyticsDto } from './dto/analytics.dto';

const DAY_MS = 86400000;
const PAGE_SIZE = 10;
type Receipt = { bookingType: 'flight' | 'hotel'; amount: number; currency: string;
  booking?: { hotelId?: Types.ObjectId; segments?: { airlineId: Types.ObjectId; fare: number }[] }; refunds: { amount: number; currency: string }[] };

@Injectable()
export class AdminAnalyticsService {
  constructor(@InjectConnection() private readonly connection: Connection,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>) {}

  async report(query: AnalyticsQueryDto): Promise<AnalyticsPageDto> {
    const start = new Date(query.from + 'T00:00:00.000Z');
    const end = new Date(query.to + 'T00:00:00.000Z');
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start.toISOString().slice(0, 10) !== query.from || end.toISOString().slice(0, 10) !== query.to || end < start || end.getTime() - start.getTime() >= 366 * DAY_MS) {
      throw new BadRequestException('Choose a valid UTC date range of at most 366 days');
    }
    const generatedAt = new Date(), exclusiveEnd = new Date(Math.min(end.getTime() + DAY_MS, generatedAt.getTime() + 1));
    const page = query.page ?? 1;
    const rows = await this.connection.transaction(async session => {
      const groups = new Map<string, ProviderAnalyticsDto>();
      const cursor = this.payments.aggregate<Receipt>([
        { $match: { bookingConfirmedAt: { $gte: start, $lt: exclusiveEnd }, status: { $in: [PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED] },
          ...(query.type ? { bookingType: query.type === 'airline' ? 'flight' : 'hotel' } : {}) } },
        { $lookup: { from: 'flightbookings', localField: 'flightBookingId', foreignField: '_id', pipeline: [{ $project: { _id: 0, 'segments.airlineId': 1, 'segments.fare': 1 } }], as: 'flight' } },
        { $lookup: { from: 'hotelbookings', localField: 'hotelBookingId', foreignField: '_id', pipeline: [{ $project: { _id: 0, hotelId: 1 } }], as: 'hotel' } },
        { $lookup: { from: 'refunds', let: { paymentId: '$_id', intent: '$stripePaymentIntentId' }, pipeline: [
          { $match: { status: RefundStatus.REFUNDED, createdAt: { $lte: generatedAt }, $expr: { $and: [{ $eq: ['$paymentId', '$$paymentId'] }, { $eq: ['$stripePaymentIntentId', '$$intent'] }] } } },
          { $project: { _id: 0, amount: 1, currency: 1 } },
        ], as: 'refunds' } },
        { $project: { _id: 0, bookingType: 1, amount: 1, currency: 1, refunds: 1,
          booking: { $cond: [{ $eq: ['$bookingType', 'flight'] }, { $arrayElemAt: ['$flight', 0] }, { $arrayElemAt: ['$hotel', 0] }] } } },
      ]).session(session).option({ maxTimeMS: 15000 }).cursor({ batchSize: 100 });
      try {
        for await (const raw of cursor) {
          const receipt = raw as Receipt;
          if (!['flight', 'hotel'].includes(receipt.bookingType)) throw unavailable();
          const gross = minor(receipt.amount, receipt.currency);
          const refunded = receipt.refunds.reduce((sum, refund) => safeSum(sum, minor(refund.amount, refund.currency)), 0);
          if (refunded > gross) throw unavailable();
          const type = receipt.bookingType === 'flight' ? 'airline' : 'hotel';
          const providers = receipt.bookingType === 'flight'
            ? receipt.booking?.segments?.map(segment => ({ id: segment.airlineId?.toString(), weight: segment.fare }))
            : receipt.booking?.hotelId ? [{ id: receipt.booking.hotelId.toString(), weight: 1 }] : undefined;
          if (!providers?.length || providers.some(provider => !/^[a-f\d]{24}$/i.test(provider.id ?? ''))) throw unavailable();
          // Fix gross attribution once. Refund weights are these allocated gross cents, so
          // gross stays stable, no provider goes negative and all columns reconcile exactly.
          let grossShares: Map<string, number>, refundShares: Map<string, number>;
          try { grossShares = allocateMinor(gross, providers); refundShares = allocateMinor(refunded, [...grossShares].map(([id, weight]) => ({ id, weight }))); }
          catch { throw unavailable(); }
          for (const [id, allocatedGross] of grossShares) {
            const key = type + ':' + id;
            let row = groups.get(key);
            if (!row) {
              row = { type, ...(type === 'airline' ? { airlineId: id } : { hotelId: id }), name: '', bookings: 0, grossRevenueMinor: 0, refundedMinor: 0, netRevenueMinor: 0, currency: PLATFORM_CURRENCY };
              groups.set(key, row);
            }
            row.bookings++;
            row.refundedMinor = safeSum(row.refundedMinor, refundShares.get(id)!);
            row.netRevenueMinor = safeSum(row.netRevenueMinor, allocatedGross - refundShares.get(id)!);
            row.grossRevenueMinor = safeSum(row.netRevenueMinor, row.refundedMinor);
          }
        }
      } finally { await cursor.close(); }
      const all = [...groups.values()].sort((a, b) => b.netRevenueMinor - a.netRevenueMinor || a.type.localeCompare(b.type) || (a.airlineId ?? a.hotelId)!.localeCompare((b.airlineId ?? b.hotelId)!));
      const items = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      const airlines = await
        this.airlines.find({ _id: { $in: items.flatMap(row => row.airlineId ? [new Types.ObjectId(row.airlineId)] : []) } }).select('_id name').session(session).lean().exec();
      const hotels = await this.hotels.find({ _id: { $in: items.flatMap(row => row.hotelId ? [new Types.ObjectId(row.hotelId)] : []) } }).select('_id name').session(session).lean().exec();
      const airlineNames = new Map(airlines.map(provider => [provider._id.toString(), provider.name]));
      const hotelNames = new Map(hotels.map(provider => [provider._id.toString(), provider.name]));
      items.forEach(row => { row.name = (row.airlineId ? airlineNames.get(row.airlineId) : hotelNames.get(row.hotelId!)) ?? 'Unavailable provider'; });
      return { items, total: all.length };
    }, { readConcern: { level: 'snapshot' }, readPreference: 'primary' });
    return { from: query.from, to: query.to, generatedAt, basis: 'Paid confirmation-date cohort (UTC); completed refunds through generatedAt. Flight gross receipts use stored-fare weights; refunds use allocated gross weights, both with largest-remainder cents. Provider payouts are not calculated; mixed-airline counts are not additive.', ...rows, page, pageSize: PAGE_SIZE };
  }
}
function unavailable() { return new ServiceUnavailableException('Analytics source records need reconciliation; no partial totals were returned'); }
function safeSum(a: number, b: number) { const sum = a + b; if (!Number.isSafeInteger(sum)) throw unavailable(); return sum; }
function minor(amount: number, currency: string) {
  if (currency !== PLATFORM_CURRENCY || !Number.isFinite(amount) || amount < 0) throw unavailable();
  const result = Math.round(amount * 100);
  if (!Number.isSafeInteger(result) || Math.abs(amount * 100 - result) > 0.000001) throw unavailable();
  return result;
}
