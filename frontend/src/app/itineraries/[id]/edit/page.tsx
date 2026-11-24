import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ErrorAlert } from '@/components/ui/error-alert';
import { loginHref } from '@/config/routes';
import { getServerSession } from '@/lib/api/server-session';
import { ItineraryEditor } from '@/features/itineraries/itinerary-editor';
import { loadItinerary } from '@/features/itineraries/server';

// Rendering: dynamic SSR shell with the owner's current itinerary, then a Client Component
// editor for the interactive mutations. Never cached; only the owner may edit (ACC-11).
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Edit itinerary', robots: { index: false } };

export default async function EditItineraryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const here = `/itineraries/${encodeURIComponent(id)}/edit`;
  const viewer = await getServerSession().catch(() => null);
  if (!viewer) redirect(loginHref(here));
  const result = await loadItinerary(id);
  if (result.kind === 'unauthenticated') redirect(loginHref(here));
  if (result.kind === 'not-found' || result.kind === 'forbidden') notFound();
  if (result.kind === 'error') {
    return <div className="stack"><ErrorAlert title="This itinerary could not be loaded" message={result.message} /><a href={here}>Try again</a></div>;
  }
  // A public itinerary is readable by others, but only its owner may edit it.
  if (result.data.userId !== viewer.userId) notFound();
  return <ItineraryEditor initial={result.data} />;
}
