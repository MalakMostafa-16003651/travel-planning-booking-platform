import { Types } from 'mongoose';
import { BookingType } from './bookings-port';

export const BOOKING_TYPES: BookingType[] = ['flight', 'hotel', 'flight-change'];

// Team rule: a record points to a booking with flightBookingId OR hotelBookingId.
export function bookingIdField(type: BookingType): 'flightBookingId' | 'hotelBookingId' | 'flightBookingChangeId' {
  return type === 'flight' ? 'flightBookingId' : type === 'flight-change' ? 'flightBookingChangeId' : 'hotelBookingId';
}

/** The { flightBookingId } / { hotelBookingId } part of a document or query. */
export function bookingRef(type: BookingType, bookingId: string) {
  return { [bookingIdField(type)]: new Types.ObjectId(bookingId) };
}

/** Reads the booking id back from a Payment, Refund or PolicyAcceptance. */
export function readBookingId(doc: { bookingType?: BookingType; flightBookingId?: Types.ObjectId; hotelBookingId?: Types.ObjectId; flightBookingChangeId?: Types.ObjectId }): string {
  const primary = doc.bookingType === 'flight' ? doc.flightBookingId : doc.bookingType === 'hotel' ? doc.hotelBookingId : doc.bookingType === 'flight-change' ? doc.flightBookingChangeId : doc.flightBookingId ?? doc.hotelBookingId ?? doc.flightBookingChangeId;
  return primary?.toString() ?? '';
}
