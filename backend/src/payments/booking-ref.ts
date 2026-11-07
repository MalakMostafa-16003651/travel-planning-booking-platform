import { Types } from 'mongoose';
import { BookingType } from './bookings-port';

export const BOOKING_TYPES: BookingType[] = ['flight', 'hotel'];

// Team rule: a record points to a booking with flightBookingId OR hotelBookingId.
export function bookingIdField(type: BookingType): 'flightBookingId' | 'hotelBookingId' {
  return type === 'flight' ? 'flightBookingId' : 'hotelBookingId';
}

/** The { flightBookingId } / { hotelBookingId } part of a document or query. */
export function bookingRef(type: BookingType, bookingId: string) {
  return { [bookingIdField(type)]: new Types.ObjectId(bookingId) };
}

/** Reads the booking id back from a Payment, Refund or PolicyAcceptance. */
export function readBookingId(doc: { flightBookingId?: Types.ObjectId; hotelBookingId?: Types.ObjectId }): string {
  return (doc.flightBookingId ?? doc.hotelBookingId)?.toString() ?? '';
}
