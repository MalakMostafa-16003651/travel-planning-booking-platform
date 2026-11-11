import { ClientSession } from 'mongoose';

export const FLIGHT_INVENTORY = 'FLIGHT_INVENTORY';

export interface BookableFlight {
  flightId: string;
  airlineId: string;
  flightNumber: string;
  status: string;
  departureAt: Date;
  arrivalAt: Date;
  departureAirportId: string;
  arrivalAirportId: string;
  departureAirportCode: string;
  arrivalAirportCode: string;
  departureTimeZone: string;
  arrivalTimeZone: string;
}

export interface BookableCabin {
  cabinId: string;
  flightId: string;
  cabinClass: string;
  price: number;
  baggageMaxWeightKg: number;
  availableSeats: number;
  /** Additive capacity metadata used by the optional FLT-28 seat map. */
  totalSeats?: number;
}

export interface CancellationTier {
  daysBeforeDeparture: number;
  refundPercentage: number;
}

export interface AirlineBookingPolicy {
  airlineId: string;
  isActive: boolean;
  pricePerExtraBag: number;
  maxExtraBagsPerPassenger: number;
  cancellationTiers: CancellationTier[];
}

/** Everything flight booking needs from the Flights module (Person 3). */
export interface FlightInventoryPort {
  getFlight(flightId: string, session?: ClientSession): Promise<BookableFlight | null>;
  /** Real shared Flight write: serializes hold/confirmation/user cancellation with provider edits. */
  acquireBookingGate(flightId: string, session: ClientSession): Promise<BookableFlight | null>;
  getCabin(cabinId: string, session?: ClientSession): Promise<BookableCabin | null>;
  getAirlinePolicy(airlineId: string, session?: ClientSession): Promise<AirlineBookingPolicy | null>;
  /** Active airline admission, serialized with admin deactivation; not required for cancelling history. */
  acquireAirlineBookingGate(airlineId: string, session: ClientSession): Promise<AirlineBookingPolicy | null>;
  /** Returns false, changing nothing, unless enough seats remain. */
  reserveSeats(cabinId: string, seats: number, session: ClientSession): Promise<boolean>;
  convertHeldToBooked(cabinId: string, seats: number, session: ClientSession): Promise<boolean>;
  releaseHeldSeats(cabinId: string, seats: number, session: ClientSession): Promise<boolean>;
  releaseBookedSeats(cabinId: string, seats: number, session: ClientSession): Promise<boolean>;
}
