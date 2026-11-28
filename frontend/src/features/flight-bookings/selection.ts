import { criteriaToParams } from '@/lib/flights/format';
import { localIsoDate } from './format';
import type { BookingSegment, FlightSelection, PassengerType, SegmentChoice } from './types';

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const MAX_PASSENGERS = 50;

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function readSegment(value: unknown): SegmentChoice | null {
  if (typeof value !== 'object' || value === null) return null;
  const { flightId, cabinId } = value as Record<string, unknown>;
  if (typeof flightId !== 'string' || typeof cabinId !== 'string' || !OBJECT_ID.test(flightId) || !OBJECT_ID.test(cabinId)) return null;
  return { flightId, cabinId };
}

/**
 * Reads ?selection= from Gamila's results page (issue #131). The URL is editable, so anything that is
 * not a valid selection becomes null. The backend still checks flights, cabins and passenger rules.
 */
export function parseSelection(raw: string | undefined): FlightSelection | null {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (typeof value !== 'object' || value === null) return null;
  const { segments, adults, children = 0, infants = 0 } = value as Record<string, unknown>;
  if (!Array.isArray(segments) || segments.length < 1 || segments.length > 2) return null;
  const choices = segments.map(readSegment);
  if (choices.some(choice => choice === null)) return null;
  if (!isCount(adults) || !isCount(children) || !isCount(infants)) return null;
  if (adults < 1 || infants > adults || adults + children + infants > MAX_PASSENGERS) return null;
  return { segments: choices as SegmentChoice[], adults, children, infants };
}

export function selectionHref(selection: FlightSelection): string {
  return `/bookings/flights/new?selection=${encodeURIComponent(JSON.stringify(selection))}`;
}

type Leg = Pick<BookingSegment, 'departureAirportCode' | 'arrivalAirportCode' | 'departureAt' | 'departureTimeZone'>;

/** Back to the search results for the same trip and travelers, so nobody types the route again. */
export function searchHref(segments: Leg[], passengers: { type: PassengerType }[]): string {
  const [outbound, inbound] = segments;
  if (!outbound) return '/flights';
  const amount = (type: PassengerType) => passengers.filter(passenger => passenger.type === type).length;
  return `/flights?${criteriaToParams({
    departureAirportCode: outbound.departureAirportCode,
    arrivalAirportCode: outbound.arrivalAirportCode,
    departureDate: localIsoDate(outbound.departureAt, outbound.departureTimeZone),
    roundTrip: Boolean(inbound),
    returnDate: inbound && localIsoDate(inbound.departureAt, inbound.departureTimeZone),
    adults: amount('ADULT'), children: amount('CHILD'), infants: amount('INFANT'),
  })}`;
}
