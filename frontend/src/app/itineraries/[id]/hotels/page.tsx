import type { Metadata } from 'next';
import { StayHotelSearchPanel } from '@/features/itineraries/stay-hotel-search';
import { TravelPageShell, loadTravelItinerary } from '@/features/itineraries/travel-page';

// Rendering: dynamic SSR shell (owner or public itinerary, read with the viewer's cookies, never
// cached) and a Client Component for the interactive search, whose criteria live in the URL.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Hotels for your trip', robots: { index: false } };

type Query = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const whole = (value: string | undefined, fallback: number, max: number) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= max ? number : fallback;
};

export default async function StayHotelsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params;
  const query = await searchParams;
  const itinerary = await loadTravelItinerary(id, `/itineraries/${encodeURIComponent(id)}/hotels`);
  const groups = 'error' in itinerary ? [] : itinerary.cityGroups;
  // A dayId from the URL selects its stop; the stop is keyed by its first day.
  const asked = one(query.dayId);
  const group = groups.find(candidate => asked && candidate.dayIds.includes(asked)) ?? groups[0];
  return (
    <TravelPageShell itinerary={itinerary} title="Hotels for a city stop" intro="Check-in is the stop's first day and check-out the day after its last day. Pick a hotel to choose rooms and book.">
      {group && (
        <StayHotelSearchPanel
          itineraryId={id}
          groups={groups}
          initial={{ dayId: group.dayIds[0], guests: whole(one(query.guests), 1, 20), rooms: whole(one(query.rooms), 1, 20), page: whole(one(query.page), 1, 10_000) }}
        />
      )}
    </TravelPageShell>
  );
}
