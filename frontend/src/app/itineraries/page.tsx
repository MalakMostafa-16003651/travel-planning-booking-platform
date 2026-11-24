import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { buttonClassName } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/error-alert';
import { loginHref } from '@/config/routes';
import { ItineraryCard } from '@/features/itineraries/itinerary-card';
import { Pager } from '@/features/itineraries/pager';
import { loadCountryNames, loadMyItineraries } from '@/features/itineraries/server';

// Rendering: dynamic SSR. The list is private to the signed-in user, so it is fetched with
// their cookies on every request and never cached. The page number lives in the URL.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your itineraries', robots: { index: false } };

type Query = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const hrefFor = (page: number) => (page > 1 ? `/itineraries?page=${page}` : '/itineraries');

export default async function ItinerariesPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const requested = Number(one(query.page));
  const page = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  const [result, countryNames] = await Promise.all([loadMyItineraries(page), loadCountryNames()]);
  if (result.kind === 'unauthenticated') redirect(loginHref(hrefFor(page)));
  if (result.kind === 'ok' && page > 1 && page > result.data.totalPages) redirect(hrefFor(Math.max(1, result.data.totalPages)));

  return (
    <div className="stack">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Trip planning</p>
          <h1 className="m-0">Your itineraries</h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/itineraries/new" className={buttonClassName('primary')}>New itinerary</Link>
        </div>
      </header>
      {one(query.deleted) === '1' && <p role="status" className="m-0 rounded-control border border-success/30 bg-success/10 px-4 py-3 text-sm">The itinerary was deleted.</p>}
      {result.kind === 'error' && (
        <div className="grid gap-3"><ErrorAlert title="Your itineraries could not be loaded" message={result.message} /><a href={hrefFor(page)}>Try again</a></div>
      )}
      {result.kind === 'forbidden' && <ErrorAlert title="Not available" message="Your account cannot list itineraries." />}
      {result.kind === 'ok' && (result.data.total === 0 ? (
        <EmptyState
          title="No itineraries yet"
          description="Plan a trip day by day, keep a budget, and share it publicly when you are ready."
          action={<Link href="/itineraries/new" className={buttonClassName('primary')}>Create your first itinerary</Link>}
        />
      ) : (
        <>
          <p className="m-0 text-sm text-muted">{result.data.total} {result.data.total === 1 ? 'itinerary' : 'itineraries'}, most recently updated first</p>
          <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2">
            {result.data.items.map(itinerary => (
              <li key={itinerary.itineraryId}>
                <ItineraryCard itinerary={itinerary} href={`/itineraries/${encodeURIComponent(itinerary.itineraryId)}`} countryNames={countryNames} showVisibility />
              </li>
            ))}
          </ul>
          <Pager page={result.data.page} totalPages={result.data.totalPages} hrefFor={hrefFor} label="Itinerary pages" />
        </>
      ))}
    </div>
  );
}
