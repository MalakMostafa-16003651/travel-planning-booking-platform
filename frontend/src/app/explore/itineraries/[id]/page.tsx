import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buttonClassName } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { getServerSession } from '@/lib/api/server-session';
import { CloneButton } from '@/features/itineraries/clone-button';
import { ItineraryView } from '@/features/itineraries/itinerary-view';
import { loadCountryNames, loadPublicItinerary } from '@/features/itineraries/server';

// Rendering: dynamic SSR from the anonymous public endpoint, never cached. Static/ISR was
// considered and rejected here: an itinerary can stop being public through actions this page
// cannot observe (admin hide, author deactivation), so a cached copy could keep exposing it.
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const result = await loadPublicItinerary(id);
  if (result.kind !== 'ok') return { title: 'Itinerary not available', robots: { index: false } };
  const { title, dayCount, cities } = result.data;
  return { title, description: `${dayCount}-day public itinerary${cities.length ? ` through ${cities.join(', ')}` : ''}.` };
}

export default async function PublicItineraryPage({ params }: Params) {
  const { id } = await params;
  const here = `/explore/itineraries/${encodeURIComponent(id)}`;
  const [result, countryNames, viewer] = await Promise.all([loadPublicItinerary(id), loadCountryNames(), getServerSession().catch(() => null)]);
  if (result.kind === 'not-found') notFound();
  if (result.kind !== 'ok') {
    return <div className="stack"><ErrorAlert title="This itinerary could not be loaded" message={result.kind === 'error' ? result.message : 'Please try again.'} /><a href={here}>Try again</a></div>;
  }
  const itinerary = result.data;
  const isOwner = viewer?.userId === itinerary.userId;
  return (
    <div className="stack">
      <Link href="/explore/itineraries" className="text-sm">All public itineraries</Link>
      <ItineraryView
        itinerary={itinerary}
        countryNames={countryNames}
        isOwner={false}
        actions={isOwner
          ? <Link href={`/itineraries/${encodeURIComponent(id)}/edit`} className={buttonClassName('primary')}>Edit your itinerary</Link>
          // Mount points for Osama's FavoriteButton (BON-02) and Arwa's ReportAction (GEN-09) once they are on develop.
          : <CloneButton itineraryId={itinerary.itineraryId} returnTo={here} />}
      />
    </div>
  );
}
