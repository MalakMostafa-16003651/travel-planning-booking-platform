export type CabinClass = 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST';
export type FlightStatus = 'SCHEDULED' | 'CANCELLED' | 'DEPARTED';
export type FlightSort = 'price' | 'duration' | 'departureTime';

export const CABIN_CLASSES: CabinClass[] = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];

export interface Airport {
  code: string;
  name: string;
  city: string;
  country: string;
  timeZone: string;
}

export interface FlightCabin {
  cabinId: string;
  cabinClass: CabinClass;
  /** USD integer minor units (cents). Use formatMoneyMinorUnits. */
  price: number;
  totalSeats: number;
  bookedSeats: number;
  heldSeats: number;
  seatsRemaining: number;
  baggageAllowanceCount: number;
  baggageMaxWeightKg: number;
}

export interface Flight {
  flightId: string;
  airlineId: string;
  airlineName: string;
  airlineCode: string;
  flightNumber: string;
  status: FlightStatus;
  departureAirport: Airport;
  arrivalAirport: Airport;
  departureAtUtc: string;
  arrivalAtUtc: string;
  departureLocalDateTime: string;
  arrivalLocalDateTime: string;
  durationMinutes: number;
  cabins: FlightCabin[];
  baggagePolicy?: { pricePerExtraBag: number; maxExtraBagsPerPassenger: number };
  cancellationTiers?: { daysBeforeDeparture: number; refundPercentage: number }[];
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface SearchCriteria {
  departureAirportCode: string;
  arrivalAirportCode: string;
  roundTrip: boolean;
  departureDate: string;
  returnDate?: string;
  adults: number;
  children: number;
  infants: number;
  cabinClass?: CabinClass;
}

/** Shared with the booking flow (Ismail) and the itinerary builder (Kiki). */
export interface FlightSelection {
  segments: { flightId: string; cabinId: string }[];
  adults: number;
  children: number;
  infants: number;
}
