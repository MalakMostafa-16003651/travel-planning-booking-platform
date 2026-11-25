import type { BookingStatus } from '@/components/booking/booking-status';

// Wire types for the payment endpoints, copied from backend/src/payments (controllers, services and
// dto/payment-response.dto.ts). Units differ per endpoint: see MONEY_FIELDS in ./money.ts.

/** The three things a traveler can pay for. The id is flightBookingId, hotelBookingId or flightBookingChangeId. */
export type CheckoutType = 'flight' | 'hotel' | 'flight-change';
export const CHECKOUT_TYPES: readonly CheckoutType[] = ['flight', 'hotel', 'flight-change'];

export function isCheckoutType(value: string): value is CheckoutType {
  return (CHECKOUT_TYPES as readonly string[]).includes(value);
}

/** Every booking, change, payment and refund id is a MongoDB ObjectId. */
export function isObjectId(value: string): boolean {
  return /^[0-9a-f]{24}$/iu.test(value);
}

export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
export type RefundStatus = 'PENDING' | 'REFUNDED' | 'FAILED';

/** GET /api/payments/:id. amount is MAJOR units (dollars). */
export interface Payment {
  _id: string;
  bookingType: CheckoutType;
  flightBookingId?: string;
  hotelBookingId?: string;
  flightBookingChangeId?: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

/** POST /api/payments and POST /api/payments/:id/retry. The clientSecret is only ever given to Stripe.js. */
export interface PaymentStart {
  payment: Payment;
  clientSecret: string;
}

/** GET /api/refunds/:id. amount is MAJOR units (dollars). */
export interface Refund {
  _id: string;
  paymentId: string;
  amount: number;
  currency: string;
  status: RefundStatus;
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

/** Flights count days before departure, hotels days before check-in. */
export interface CancellationTier {
  daysBeforeDeparture?: number;
  daysBeforeCheckIn?: number;
  refundPercentage: number;
}

/** pricePerExtraBag is MAJOR units here (the adapter divides the airline's cents by 100). */
export interface BaggagePolicy {
  airlineId: string;
  pricePerExtraBag: number;
  maxExtraBagsPerPassenger: number;
  cabinClass?: string;
}

/** Flight changes add the old and new fare, in MAJOR units (flight-booking-changes.service.ts). */
export interface ChangePolicyFigures {
  previousAmount: number;
  totalAmount: number;
  differenceAmount: number;
}

export interface Policies {
  cancellation: { tiers: CancellationTier[] };
  baggage?: BaggagePolicy[];
  checkInOut?: { checkInTime: string; checkOutTime: string };
  change?: ChangePolicyFigures;
}

/** GET /api/bookings/:type/:id/policies. amount is MAJOR units and is what Stripe will charge. */
export interface BookingPolicies {
  bookingType: CheckoutType;
  bookingId: string;
  policies: Policies;
  amount: number;
  currency: string;
}

/** POST /api/bookings/:type/:id/accept-policies: the stored PolicyAcceptance. */
export interface PolicyAcceptance {
  _id: string;
  acceptedAt: string;
}

// The few booking fields checkout reads. Amounts are integer MINOR units (cents) on all three.

export interface FlightSegmentSummary {
  airlineId: string;
  flightNumber: string;
  departureAirportCode: string;
  arrivalAirportCode: string;
  departureAt: string;
  departureTimeZone: string;
}

/** GET /api/flight-bookings/:id (backend/src/flight-bookings/dto/flight-booking-response.dto.ts). */
export interface FlightBookingSummary {
  flightBookingId: string;
  status: BookingStatus;
  segments: FlightSegmentSummary[];
  passengers: unknown[];
  totalAmount: number;
  currency: string;
  holdExpiresAt?: string;
  paymentId?: string;
}

/** GET /api/hotel-bookings/:id (backend/src/hotel-bookings/dto/hotel-booking-response.dto.ts). */
export interface HotelBookingSummary {
  hotelBookingId: string;
  hotelName: string;
  status: BookingStatus;
  rooms: { roomName: string }[];
  checkIn: string;
  checkOut: string;
  nights: number;
  guestCount: number;
  totalPrice: number;
  currency: string;
  holdExpiresAt?: string;
  paymentId?: string;
}

/** GET /api/flight-booking-changes/:id (backend/src/flight-bookings/dto/flight-booking-change.dto.ts). */
export interface FlightChangeSummary {
  flightBookingChangeId: string;
  flightBookingId: string;
  status: BookingStatus;
  previousAmount: number;
  totalAmount: number;
  differenceAmount: number;
  amountToPay: number;
  currency: string;
  segments: FlightSegmentSummary[];
  holdExpiresAt: string;
}

/** What the checkout page shows about the booking, built once on the server for every type. */
export interface CheckoutSummary {
  status: BookingStatus;
  holdExpiresAt?: string;
  title: string;
  details: string[];
  /** Flight number(s) per airlineId, to name the airline in the baggage policy. */
  airlineLabels: Record<string, string>;
  /** Set for flight changes: the booking the change belongs to. */
  flightBookingId?: string;
}
