import type { Metadata } from 'next';
import { FlightResults } from '@/features/flights/flight-results';
import { FlightSearch } from '@/features/flights/flight-search';
import { paramsToCriteria } from '@/lib/flights/format';
import type { FlightSort, SearchCriteria } from '@/lib/flights/types';

// Rendering: dynamic. Results depend on URL query params and live seat availability.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Search flights' };

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function FlightsPage({ searchParams }: { searchParams: Promise<Raw> }) {
  const raw = await searchParams;
  const criteria = paramsToCriteria(raw);
  const searched = Boolean(criteria.departureAirportCode && criteria.arrivalAirportCode && criteria.departureDate && (!criteria.roundTrip || criteria.returnDate));
  const sort = one(raw.sortBy);
  const page = Math.max(1, Number(one(raw.page)) || 1);
  return (
    <div className="stack">
      <h1>Search flights</h1>
      <FlightSearch variant="full" initialCriteria={criteria} />
      {searched && (
        <FlightResults
          criteria={criteria as SearchCriteria}
          page={page}
          sortBy={['price', 'duration', 'departureTime'].includes(sort ?? '') ? (sort as FlightSort) : undefined}
          minPrice={one(raw.minPrice) ?? ''}
          maxPrice={one(raw.maxPrice) ?? ''}
        />
      )}
    </div>
  );
}
