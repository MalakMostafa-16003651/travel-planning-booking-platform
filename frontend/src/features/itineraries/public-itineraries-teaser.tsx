import Link from 'next/link';
import { buttonClassName } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ItineraryPreview } from './itinerary-preview';
import { loadCountryNames, searchPublicItineraries } from './server';

/**
 * Home "Explore itineraries" slot (HomeContent `itineraries`). Server Component: the newest
 * public itineraries, read anonymously and uncached for the same visibility reasons as
 * /explore. It shows the first few of page 1 only and links to the full paginated search.
 */
export async function PublicItinerariesTeaser({ limit = 3 }: { limit?: number }) {
  const [result, countryNames] = await Promise.all([searchPublicItineraries({ sort: 'NEWEST' }), loadCountryNames()]);
  const explore = <Link href="/explore/itineraries" className={buttonClassName('secondary')}>Explore all itineraries</Link>;
  if (result.kind !== 'ok') return <EmptyState title="Public itineraries are unavailable right now" action={explore} />;
  if (result.data.items.length === 0) return <EmptyState title="No public itineraries yet" description="Share one of yours to be the first." action={explore} />;
  return (
    <div className="grid gap-4">
      <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
        {result.data.items.slice(0, limit).map(itinerary => (
          <li key={itinerary.itineraryId}><ItineraryPreview itinerary={itinerary} countryNames={countryNames} /></li>
        ))}
      </ul>
      <div>{explore}</div>
    </div>
  );
}
