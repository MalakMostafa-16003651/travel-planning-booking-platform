import 'server-only';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/error-alert';
import { loginHref } from '@/config/routes';
import { loadItinerary } from './server';
import type { Itinerary } from './types';

/** Shared shell for ITN-25/26: loads the readable itinerary (owner or public) or ends the request. */
export async function loadTravelItinerary(id: string, here: string): Promise<Itinerary | { error: string }> {
  const result = await loadItinerary(id);
  if (result.kind === 'unauthenticated') redirect(loginHref(here));
  if (result.kind === 'not-found' || result.kind === 'forbidden') notFound();
  if (result.kind === 'error') return { error: result.message };
  return result.data;
}

export function TravelPageShell({ itinerary, title, intro, children }: { itinerary: Itinerary | { error: string }; title: string; intro: string; children: ReactNode }) {
  if ('error' in itinerary) return <ErrorAlert title="This itinerary could not be loaded" message={itinerary.error} />;
  return (
    <div className="stack">
      <header>
        <Link href={`/itineraries/${encodeURIComponent(itinerary.itineraryId)}`} className="text-sm [overflow-wrap:anywhere]">{itinerary.title}</Link>
        <h1 className="m-0 mt-3">{title}</h1>
        <p className="m-0 mt-2 max-w-prose text-muted">{intro}</p>
      </header>
      {itinerary.days.length === 0
        ? <EmptyState title="Add days first" description="Searches use the trip's days, cities and dates." />
        : children}
    </div>
  );
}
