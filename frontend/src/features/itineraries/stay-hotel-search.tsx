'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/error-alert';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/ui/loading-state';
import { Select } from '@/components/ui/select';
import { HotelCard } from '@/features/hotels/hotel-search/HotelCard';
import { criteriaToParams } from '@/features/hotels/hotel-search/format';
import type { HotelSearchResult, Page } from '@/features/hotels/hotel-search/types';
import { ApiError } from '@/lib/api/client';
import { searchStayHotels, type StayHotelSearch } from './api';
import { formatDateOnly, pluralize } from './format';
import type { CityGroup } from './types';

type Result = StayHotelSearch<Page<HotelSearchResult>>;

function describe(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Hotels could not be loaded. Please try again.';
  const field = Object.entries(error.fields)[0];
  if (field?.[0] === 'checkIn') return 'This stop starts in the past, so hotels cannot be searched for it. Change the trip start date first.';
  if (error.status === 503) return 'Hotel search is not available right now.';
  return field?.[1][0] ?? error.message;
}

/**
 * ITN-25: hotels for one city stop. Dates are derived by the backend from the stop (check-in =
 * first day, check-out = the day after the last) and only displayed here; results come from
 * Lama's HTL-11 search and are shown with her HotelCard, which continues into her room selection.
 */
export function StayHotelSearchPanel({ itineraryId, groups, initial }: {
  itineraryId: string;
  groups: CityGroup[];
  initial: { dayId: string; guests: number; rooms: number; page: number };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(initial);
  const [draft, setDraft] = useState({ dayId: initial.dayId, guests: String(initial.guests), rooms: String(initial.rooms) });
  const [formError, setFormError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    searchStayHotels<Page<HotelSearchResult>>(itineraryId, query, controller.signal)
      .then(setResult)
      .catch(cause => { if (!controller.signal.aborted) { setResult(null); setError(describe(cause)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    // Keep the search in the URL so refresh and back restore it.
    router.replace(`${pathname}?${new URLSearchParams({ dayId: query.dayId, guests: String(query.guests), rooms: String(query.rooms), page: String(query.page) })}`, { scroll: false });
    return () => controller.abort();
  }, [itineraryId, query, pathname, router]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const guests = Number(draft.guests);
    const rooms = Number(draft.rooms);
    if (!Number.isInteger(guests) || guests < 1 || guests > 20) { setFormError('Guests must be a whole number from 1 to 20.'); return; }
    if (!Number.isInteger(rooms) || rooms < 1 || rooms > 20) { setFormError('Rooms must be a whole number from 1 to 20.'); return; }
    if (rooms > guests) { setFormError('Each room needs at least one guest.'); return; }
    setFormError('');
    setQuery({ dayId: draft.dayId, guests, rooms, page: 1 });
  }

  const criteria = result?.criteria;
  const page = result?.results;
  const nights = criteria ? Math.round((Date.parse(criteria.checkOut) - Date.parse(criteria.checkIn)) / 86_400_000) : 0;

  return (
    <div className="stack">
      <form className="grid gap-4 rounded-card border border-border bg-card p-5" onSubmit={submit} noValidate>
        <div className="grid items-start gap-4 md:grid-cols-3">
          <FormField id="stay-stop" label="City stop">
            <Select value={draft.dayId} onChange={event => setDraft({ ...draft, dayId: event.target.value })}>
              {groups.map(group => (
                <option key={group.dayIds[0]} value={group.dayIds[0]}>
                  {group.city} · {group.dayCount === 1 ? `day ${group.firstDayNumber}` : `days ${group.firstDayNumber}–${group.lastDayNumber}`}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField id="stay-guests" label="Guests">
            <Input type="number" min={1} max={20} inputMode="numeric" value={draft.guests} onChange={event => setDraft({ ...draft, guests: event.target.value })} />
          </FormField>
          <FormField id="stay-rooms" label="Rooms">
            <Input type="number" min={1} max={20} inputMode="numeric" value={draft.rooms} onChange={event => setDraft({ ...draft, rooms: event.target.value })} />
          </FormField>
        </div>
        {formError && <p role="alert" className="m-0 text-sm text-danger">{formError}</p>}
        <div><Button type="submit" disabled={loading}>Search hotels</Button></div>
      </form>

      {criteria && (
        <p className="m-0" aria-live="polite">
          <span className="font-semibold text-ink">{criteria.city}</span>: check-in {formatDateOnly(criteria.checkIn)}, check-out {formatDateOnly(criteria.checkOut)}
          {' '}({pluralize(nights, 'night')}), {pluralize(criteria.guests, 'guest')}, {pluralize(criteria.rooms, 'room')}.
          {' '}<Link href={`/hotels?${criteriaToParams(criteria)}`}>Open in hotel search</Link> for price and rating filters.
        </p>
      )}
      {loading && <LoadingState label="Finding hotels for this stop…" />}
      {error && <ErrorAlert title="Hotels unavailable" message={error} />}
      {!loading && page && criteria && (page.items.length === 0 ? (
        <EmptyState title="No hotels have enough rooms for these dates" description="Try fewer rooms, or another city stop." />
      ) : (
        <section aria-label="Hotels for this stop" className="grid gap-4">
          <p className="m-0 text-sm text-muted">{page.total} {page.total === 1 ? 'hotel' : 'hotels'} available</p>
          {page.items.map(hotel => (
            <HotelCard key={hotel.hotelId} hotel={hotel} checkIn={criteria.checkIn} checkOut={criteria.checkOut} guests={criteria.guests} rooms={criteria.rooms} />
          ))}
          {page.totalPages > 1 && (
            <nav aria-label="Hotel result pages" className="flex items-center justify-between gap-3">
              <Button variant="secondary" disabled={query.page <= 1} onClick={() => setQuery({ ...query, page: query.page - 1 })}>Previous</Button>
              <span className="text-sm text-muted">Page {page.page} of {page.totalPages}</span>
              <Button variant="secondary" disabled={query.page >= page.totalPages} onClick={() => setQuery({ ...query, page: query.page + 1 })}>Next</Button>
            </nav>
          )}
        </section>
      ))}
    </div>
  );
}
