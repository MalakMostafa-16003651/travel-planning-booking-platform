import type { Metadata } from 'next';
import { TripFlightSearchPanel } from '@/features/itineraries/trip-flight-search';
import { TravelPageShell, loadTravelItinerary } from '@/features/itineraries/travel-page';
import type { TripFlightQuery } from '@/features/itineraries/api';

// Rendering: dynamic SSR shell with the readable itinerary (never cached) and a Client Component
// for the search; criteria are kept in the URL for refresh and back.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Flights for your trip', robots: { index: false } };

type Query = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function fromUrl(query: Query): TripFlightQuery | null {
  const origin = one(query.departureAirportCode)?.toUpperCase();
  if (!origin || !/^[A-Z]{3}$/.test(origin)) return null;
  const count = (key: string, fallback: number) => { const n = Number(one(query[key])); return Number.isInteger(n) && n >= 0 ? n : fallback; };
  const date = (key: string) => { const value = one(query[key]); return value && DATE.test(value) ? value : undefined; };
  const roundTrip = one(query.roundTrip) === 'true';
  return {
    departureAirportCode: origin, roundTrip, departureDate: date('departureDate'), returnDate: roundTrip ? date('returnDate') : undefined,
    adults: Math.max(1, count('adults', 1)), children: count('children', 0), infants: count('infants', 0),
    cabinClass: one(query.cabinClass) || undefined, page: Math.max(1, count('page', 1)),
  };
}

export default async function TripFlightsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params;
  const query = await searchParams;
  const itinerary = await loadTravelItinerary(id, `/itineraries/${encodeURIComponent(id)}/flights`);
  const firstCity = 'error' in itinerary ? '' : itinerary.days[0]?.city ?? '';
  return (
    <TravelPageShell itinerary={itinerary} title={`Flights to ${firstCity || 'your trip'}`} intro="Searches every airport in the city of day 1. Departure defaults to the trip's first day and the return to its last day.">
      {!('error' in itinerary) && firstCity && (
        <TripFlightSearchPanel
          itineraryId={id}
          firstCity={firstCity}
          defaults={{ departureDate: itinerary.startDate, returnDate: itinerary.endDate }}
          initial={fromUrl(query)}
        />
      )}
    </TravelPageShell>
  );
}
