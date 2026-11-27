import type { CheckoutType } from './types';

// Where checkout sends the traveler, as agreed with Ismail in issue #140 and reserved for Osama in
// docs/m2/ROUTES_AND_HANDOFFS.md. Ids are always our own ObjectIds, but they are still encoded.

/** BookingStepper steps for checkout and its result page. */
export const checkoutSteps = [
  { id: 'policies', label: 'Review policies' },
  { id: 'pay', label: 'Pay' },
  { id: 'confirmation', label: 'Confirmation' },
];

export interface CheckoutLinks {
  /** After a confirmed payment. */
  done: string;
  /** Leaving checkout without paying, or after the hold ended. */
  back: string;
}

/** For flight-change, bookingId is the change id and flightBookingId the booking it belongs to. */
export function checkoutLinks(type: CheckoutType, bookingId: string, flightBookingId?: string): CheckoutLinks {
  const id = encodeURIComponent(bookingId);
  if (type === 'flight') return { done: `/bookings/flights/${id}/ticket`, back: `/bookings/flights/${id}` };
  if (type === 'hotel') return { done: `/bookings/hotels/${id}`, back: `/bookings/hotels/${id}` };
  // Without the parent booking (it could not be read) the traveler still gets to their flight list.
  const change = flightBookingId ? `/bookings/flights/${encodeURIComponent(flightBookingId)}/change?change=${id}` : '/bookings/flights';
  return { done: change, back: change };
}

export function checkoutPath(type: CheckoutType, bookingId: string): string {
  return `/checkout/${type}/${encodeURIComponent(bookingId)}`;
}

/** The page Stripe returns to, and the page checkout opens after confirmPayment. It verifies with the backend. */
export function resultPath(type: CheckoutType, bookingId: string, paymentId: string): string {
  return `/checkout/result?${new URLSearchParams({ type, bookingId, paymentId })}`;
}
