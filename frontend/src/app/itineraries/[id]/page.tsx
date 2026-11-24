import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { buttonClassName } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { loginHref } from '@/config/routes';
import { getServerSession } from '@/lib/api/server-session';
import { ItineraryView } from '@/features/itineraries/itinerary-view';
import { loadCountryNames, loadItinerary } from '@/features/itineraries/server';

// Rendering: dynamic SSR, no caching. The same URL serves the owner's private trip and a
// public trip to anyone, so the response depends on the viewer's cookies and must never be
// shared. Private trips of other users are a 404 from the backend (ACC-11).
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Itinerary', robots: { index: false } };

export default async function ItineraryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const here = `/itineraries/${encodeURIComponent(id)}`;
  const [result, countryNames, viewer] = await Promise.all([loadItinerary(id), loadCountryNames(), getServerSession().catch(() => null)]);
  if (result.kind === 'not-found' || result.kind === 'forbidden') notFound();
  if (result.kind === 'unauthenticated') redirect(loginHref(here));
  if (result.kind === 'error') {
    return <div className="stack"><ErrorAlert title="This itinerary could not be loaded" message={result.message} /><a href={here}>Try again</a></div>;
  }
  const itinerary = result.data;
  const isOwner = viewer?.userId === itinerary.userId;
  return (
    <div className="stack">
      <Link href={isOwner ? '/itineraries' : '/'} className="text-sm">{isOwner ? 'Your itineraries' : 'Home'}</Link>
      <ItineraryView
        itinerary={itinerary}
        countryNames={countryNames}
        isOwner={isOwner}
        actions={isOwner ? <Link href={`${here}/edit`} className={buttonClassName('primary')}>Edit itinerary</Link> : undefined}
      />
    </div>
  );
}
