import type { Metadata } from 'next';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/error-alert';
import { ItineraryCard } from '@/features/itineraries/itinerary-card';
import { Pagination } from '@/components/data-table';
import { PublicFilters } from '@/features/itineraries/public-filters';
import { loadCities, loadCountryNames, searchPublicItineraries, type PublicSearch } from '@/features/itineraries/server';

// Rendering: dynamic SSR, anonymous. Results depend on the query string, and visibility can
// change at any moment (owner makes it private, admin hides it, author is deactivated), so the
// list is read fresh with no cookies and no shared cache. Only the catalogs are cached (5 min).
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Explore itineraries',
  description: 'Browse public trip plans by destination and length, and clone one to start your own.',
};

type Query = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
const SORTS = ['NEWEST', 'OLDEST', 'TITLE', 'SHORTEST', 'LONGEST'] as const;

function parse(query: Query) {
  const errors: Partial<Record<'q' | 'minDays' | 'maxDays', string>> = {};
  const days = (key: 'minDays' | 'maxDays') => {
    const raw = one(query[key]);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) { errors[key] = 'Enter a whole number of days, at least 1.'; return undefined; }
    return value;
  };
  const q = one(query.q);
  if (q && q.length > 100) errors.q = 'Use at most 100 characters.';
  const minDays = days('minDays');
  const maxDays = days('maxDays');
  if (minDays !== undefined && maxDays !== undefined && minDays > maxDays) errors.maxDays = 'Maximum days must not be less than minimum days.';
  const sort = SORTS.find(item => item === one(query.sort)?.toUpperCase());
  const page = Number(one(query.page));
  const country = one(query.country)?.toUpperCase();
  const search: PublicSearch = {
    q: errors.q ? undefined : q,
    country: country && /^[A-Z]{2}$/.test(country) ? country : undefined,
    city: one(query.city),
    minDays, maxDays,
    sort,
    page: Number.isSafeInteger(page) && page > 1 ? page : undefined,
  };
  return { search, errors };
}

function hrefFor(search: PublicSearch, page: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...search, page: page > 1 ? page : undefined })) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.size ? `/explore/itineraries?${params}` : '/explore/itineraries';
}

export default async function ExploreItinerariesPage({ searchParams }: { searchParams: Promise<Query> }) {
  const { search, errors } = parse(await searchParams);
  const invalid = Object.keys(errors).length > 0;
  const [result, countryNames, cities] = await Promise.all([
    invalid ? Promise.resolve(null) : searchPublicItineraries(search),
    loadCountryNames(),
    loadCities(),
  ]);
  const countries = Object.entries(countryNames).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
  const filtered = Boolean(search.q || search.country || search.city || search.minDays || search.maxDays);

  return (
    <div className="stack">
      <header>
        <p className="eyebrow">Public itineraries</p>
        <h1 className="m-0">Explore trips by other travelers</h1>
        <p className="m-0 mt-2 max-w-prose text-muted">Read day-by-day plans and budgets, then clone one as a private starting point for your own trip.</p>
      </header>
      <PublicFilters search={search} countries={countries} cities={cities} errors={errors} />
      {invalid && <p role="alert" className="m-0 text-sm text-danger">Fix the highlighted filters to search.</p>}
      {result?.kind === 'error' && <div className="grid gap-3"><ErrorAlert title="Search unavailable" message={result.message} /><a href={hrefFor(search, search.page ?? 1)}>Try again</a></div>}
      {result?.kind === 'ok' && (result.data.total === 0 ? (
        <EmptyState
          title={filtered ? 'No itineraries match these filters' : 'No public itineraries yet'}
          description={filtered ? 'Try another keyword, a wider day range, or clear the filters.' : 'When travelers share their plans publicly, they appear here.'}
        />
      ) : (
        <section aria-labelledby="explore-results" className="grid gap-4">
          <h2 id="explore-results" className="m-0 text-base font-semibold text-muted" aria-live="polite">
            {result.data.total} {result.data.total === 1 ? 'itinerary' : 'itineraries'} found
          </h2>
          <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2">
            {result.data.items.map(itinerary => (
              <li key={itinerary.itineraryId}>
                <ItineraryCard itinerary={itinerary} href={`/explore/itineraries/${encodeURIComponent(itinerary.itineraryId)}`} countryNames={countryNames} showAuthor />
              </li>
            ))}
          </ul>
          <Pagination page={result.data.page} totalPages={result.data.totalPages} total={result.data.total} pageSize={result.data.pageSize} hrefForPage={page => hrefFor(search, page)} label="Search result pages" />
        </section>
      ))}
    </div>
  );
}
