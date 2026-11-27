import type { BookingStatus } from '@/components/booking/booking-status';
import type { CabinClass, Flight, FlightCabin, FlightSelection, Page } from '@/lib/flights/types';

// Flights, airports and the selection belong to Person 3.
export type { Airport, CabinClass, FlightSelection } from '@/lib/flights/types';
export type OfferedFlight = Flight;
export type OfferedCabin = FlightCabin;
export type OfferedFlightPage = Page<Flight>;

// Wire types for Person 4's endpoints, copied from backend/src/flight-bookings/dto.
// Every amount here is an integer in USD minor units; dates are ISO strings.

export type PassengerType = 'ADULT' | 'CHILD' | 'INFANT';
export type BookingGroup = 'UPCOMING' | 'PAST' | 'CANCELLED';

export type SegmentChoice = FlightSelection['segments'][number];

export interface BookingSegment extends SegmentChoice {
  airlineId: string;
  cabinClass: CabinClass;
  fare: number;
  flightNumber: string;
  departureAirportCode: string;
  arrivalAirportCode: string;
  departureAt: string;
  arrivalAt: string;
  departureTimeZone: string;
  arrivalTimeZone: string;
}

export interface PassengerSummary {
  fullName: string;
  type: PassengerType;
  extraBags: number;
  extraBaggageWeightKg: number;
}

export interface PassengerDetails extends PassengerSummary {
  passengerId: string;
  dateOfBirth: string;
  documentNumber: string;
}

export interface PassengerInput {
  fullName: string;
  dateOfBirth: string;
  documentNumber: string;
  type: PassengerType;
  extraBags?: number;
  extraBaggageWeightKg?: number;
}

export interface BookingRequest {
  segments: SegmentChoice[];
  passengers: PassengerInput[];
}

/** POST /flight-bookings: the server-priced summary. It reserves nothing. */
export interface BookingSummary {
  segments: BookingSegment[];
  passengers: PassengerSummary[];
  seatCount: number;
  baggageFee: number;
  totalAmount: number;
  currency: string;
}

export interface RefundStatus {
  refundId: string;
  status: 'PENDING' | 'REFUNDED' | 'FAILED';
  amount: number;
  currency: string;
}

export interface SeatChoice {
  flightId: string;
  passengerId: string;
  seatNumber: number;
}

export interface FlightBooking {
  flightBookingId: string;
  userId: string;
  status: BookingStatus;
  bookingReference?: string;
  segments: BookingSegment[];
  passengers: PassengerDetails[];
  seatCount: number;
  baggageFee: number;
  totalAmount: number;
  currency: string;
  holdExpiresAt?: string;
  paymentId?: string;
  refundId?: string;
  refundAmount?: number;
  refund?: RefundStatus;
  seatSelections?: SeatChoice[];
  cancelledAt?: string;
  cancelledBy?: 'USER' | 'AIRLINE';
  createdAt: string;
  updatedAt: string;
}

/** This list has no totalPages; derive it from total and pageSize. */
export interface FlightBookingPage {
  items: FlightBooking[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CancellationQuote {
  flightBookingId: string;
  daysBeforeDeparture: number;
  refundPercentage: number;
  refundAmount: number;
  totalAmount: number;
  currency: string;
}

/** FLT-27. PENDING is a replacement hold; CONFIRMED means the switch was applied. */
export interface FlightBookingChange {
  flightBookingChangeId: string;
  flightBookingId: string;
  status: BookingStatus;
  previousAmount: number;
  totalAmount: number;
  differenceAmount: number;
  amountToPay: number;
  refundAmount: number;
  currency: string;
  segments: BookingSegment[];
  holdExpiresAt: string;
  appliedAt?: string;
  refund?: RefundStatus;
  refundDue: boolean;
}

export interface SeatMapSegment extends SegmentChoice {
  capacity: number;
  modifiable: boolean;
  occupiedSeatNumbers: number[];
}

export interface SeatMap {
  flightBookingId: string;
  segments: SeatMapSegment[];
  selections: SeatChoice[];
}

export interface CancellationTier {
  daysBeforeDeparture: number;
  refundPercentage: number;
}

/** GET /bookings/flight-change/:id/policies. Amounts in this response are MAJOR units. */
export interface ChangePolicies {
  policies: {
    cancellation: { tiers: CancellationTier[] };
    baggage: { airlineId: string; pricePerExtraBag: number; maxExtraBagsPerPassenger: number; cabinClass?: CabinClass }[];
  };
}
