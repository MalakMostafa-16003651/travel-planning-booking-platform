import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { isDeepStrictEqual } from 'node:util';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { bookingRef } from './booking-ref';
import { BOOKINGS_PORT, type BookingsPort, BookingType, PayableBooking } from './bookings-port';
import { PolicyAcceptance } from './schemas/policy-acceptance.schema';

const DUPLICATE_KEY = 11000;

// MongoDB drops undefined keys and may change value types, so compare plain JSON.
function normalizePolicies(policies: unknown): unknown {
  return JSON.parse(JSON.stringify(policies ?? null));
}

@Injectable()
export class PoliciesService {
  constructor(
    @Inject(BOOKINGS_PORT) private readonly bookingsPort: BookingsPort,
    @InjectModel(PolicyAcceptance.name) private readonly acceptances: Model<PolicyAcceptance>,
  ) {}

  /** PAY-02: what the user must accept before paying. */
  async getPolicies(type: BookingType, bookingId: string, userId: string) {
    const booking = await this.getOwnedBooking(type, bookingId, userId);
    return {
      bookingType: type,
      bookingId: booking.bookingId,
      policies: booking.policies,
      amount: booking.totalPrice,
      currency: booking.currency,
    };
  }

  /** PAY-02: stores, or refreshes, the user's acceptance of the current policies. */
  async acceptPolicies(type: BookingType, bookingId: string, userId: string) {
    const booking = await this.getOwnedBooking(type, bookingId, userId);
    if (booking.status !== BookingStatus.PENDING) {
      throw new ConflictException('Policies can only be accepted while the booking is PENDING');
    }
    const filter = { userId: new Types.ObjectId(userId), bookingType: type, ...bookingRef(type, bookingId) };
    const update = { $set: { policies: booking.policies, acceptedAt: new Date() } };
    try {
      return await this.acceptances
        .findOneAndUpdate(filter, update, { upsert: true, returnDocument: 'after', runValidators: true })
        .exec();
    } catch (error) {
      if ((error as { code?: number }).code !== DUPLICATE_KEY) throw error;
      // Two accepts raced and the other inserted first: update that record.
      return this.acceptances.findOneAndUpdate(filter, update, { returnDocument: 'after' }).exec();
    }
  }

  /** True only if the user accepted exactly these policies; a provider change needs a new acceptance. */
  async hasAccepted(userId: string, type: BookingType, bookingId: string, currentPolicies: unknown): Promise<boolean> {
    const acceptance = await this.acceptances
      .findOne({ userId: new Types.ObjectId(userId), bookingType: type, ...bookingRef(type, bookingId) })
      .exec();
    return !!acceptance && isDeepStrictEqual(normalizePolicies(acceptance.policies), normalizePolicies(currentPolicies));
  }

  /** Another user's booking is 404, like in the booking modules. */
  async getOwnedBooking(type: BookingType, bookingId: string, userId: string): Promise<PayableBooking> {
    const booking = await this.bookingsPort.getBooking(type, bookingId, userId);
    if (!booking || booking.userId !== userId) throw new NotFoundException('Booking not found');
    return booking;
  }
}
