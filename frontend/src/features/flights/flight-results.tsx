'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/error-alert';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/ui/loading-state';
import { Select } from '@/components/ui/select';
import { ApiError, apiClient } from '@/lib/api/client';
import { cabinLabel, criteriaToParams, dollarsToMinor } from '@/lib/flights/format';
import { CABIN_CLASSES, type CabinClass, type Flight, type FlightSelection, type FlightSort, type Page, type SearchCriteria } from '@/lib/flights/types';
import { FlightCard } from './flight-card';

interface RoundTripResult { outbound: Page<Flight>; return: Page<Flight> }
type Result = { kind: 'one'; page: Page<Flight> } | { kind: 'round'; data: RoundTripResult };

export interface FlightResultsProps {
  criteria: SearchCriteria;
  page: number;
  sortBy?: FlightSort;
  minPrice?: string;
  maxPrice?: string;
  /** Where "Continue" sends the traveler. Ismail's booking page; adjust when he confirms the contract. */
  bookingHref?: string;
}

function pagesFor(page: Page<Flight>) {
  // Derive when the backend omits totalPages.
  return page.totalPages ?? Math.max(1, Math.ceil(page.total / (page.pageSize || 10)));
}

export function FlightResults({ criteria, page, sortBy, minPrice = '', maxPrice = '', bookingHref = '/bookings/flights/new' }: FlightResultsProps) {
  const router = useRouter();
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  type Pick = { flightId: string; cabinId: string };
  // The selection is stamped with the search it was made for. If the route, dates, passengers,
  // cabin or trip type change, the stamp no longer matches and the old picks are ignored.
  const [picked, setPicked] = useState<{ key: string; outbound: Pick | null; inbound: Pick | null }>({ key: '', outbound: null, inbound: null });
  const [min, setMin] = useState(minPrice);
  const [max, setMax] = useState(maxPrice);
  const baseParams = useMemo(() => criteriaToParams(criteria), [criteria]);
  const searchKey = baseParams.toString();
  const current = picked.key === searchKey ? picked : { key: searchKey, outbound: null, inbound: null };
  const outbound = current.outbound;
  const inbound = criteria.roundTrip ? current.inbound : null;
  const setOutbound = (s: Pick) => setPicked({ ...current, key: searchKey, outbound: s });
  const setInbound = (s: Pick) => setPicked({ ...current, key: searchKey, inbound: s });
   // A new search starts with no selection, even if the user later returns to an earlier search.
  useEffect(() => {
    setPicked({ key: searchKey, outbound: null, inbound: null });
  }, [searchKey]);

  const query = useMemo(() => {
    const p = new URLSearchParams(baseParams);
    p.set('page', String(page));
    if (sortBy) p.set('sortBy', sortBy);
    const lo = dollarsToMinor(minPrice);
    const hi = dollarsToMinor(maxPrice);
    if (lo !== undefined) p.set('minPrice', String(lo));
    if (hi !== undefined) p.set('maxPrice', String(hi));
    return p.toString();
  }, [baseParams, page, sortBy, minPrice, maxPrice]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    const path = criteria.roundTrip ? '/flights/search/round-trip' : '/flights/search';
    apiClient<Page<Flight> | RoundTripResult>(`${path}?${query}`)
      .then(data => {
        if (!alive) return;
        setResult(criteria.roundTrip ? { kind: 'round', data: data as RoundTripResult } : { kind: 'one', page: data as Page<Flight> });
      })
      .catch(e => { if (alive) setError(e instanceof ApiError ? e.message : 'Could not load flights.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [query, criteria.roundTrip]);

  function go(changes: Record<string, string | undefined>) {
    const p = new URLSearchParams(baseParams);
    const next = { page: String(page), sortBy, minPrice: minPrice || undefined, maxPrice: maxPrice || undefined, ...changes };
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    router.push(`/flights?${p}`);
  }

  const filtersChanged = (changes: Record<string, string | undefined>) => go({ page: '1', ...changes });

  function bookingUrl(): string {
    const selection: FlightSelection = {
      segments: [outbound, inbound].filter((s): s is Pick => Boolean(s)),
      adults: criteria.adults, children: criteria.children, infants: criteria.infants,
    };
    return `${bookingHref}?selection=${encodeURIComponent(JSON.stringify(selection))}`;
  }

  const controls = (
    <div className="grid gap-4 rounded-card border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
      <FormField id="fr-sort" label="Sort by">
        <Select value={sortBy ?? ''} onChange={e => filtersChanged({ sortBy: e.target.value || undefined })}>
          <option value="">Default</option>
          <option value="price">Price (lowest)</option>
          <option value="duration">Duration (shortest)</option>
          <option value="departureTime">Departure time</option>
        </Select>
      </FormField>
      <FormField id="fr-cabin" label="Cabin">
        <Select value={criteria.cabinClass ?? ''} onChange={e => {
          const p = new URLSearchParams(baseParams);
          if (e.target.value) p.set('cabinClass', e.target.value as CabinClass); else p.delete('cabinClass');
          router.push(`/flights?${p}`);
        }}>
          <option value="">Any cabin</option>
          {CABIN_CLASSES.map(c => <option key={c} value={c}>{cabinLabel(c)}</option>)}
        </Select>
      </FormField>
      <FormField id="fr-min" label="Min price (USD)"><Input type="number" min={0} inputMode="decimal" value={min} onChange={e => setMin(e.target.value)} /></FormField>
      <FormField id="fr-max" label="Max price (USD)"><Input type="number" min={0} inputMode="decimal" value={max} onChange={e => setMax(e.target.value)} /></FormField>
      <div className="sm:col-span-2 lg:col-span-4">
        <Button variant="secondary" onClick={() => filtersChanged({ minPrice: min || undefined, maxPrice: max || undefined })}>Apply price filter</Button>
      </div>
    </div>
  );

  function renderList(title: string, data: Page<Flight>, selected: Pick | null, set: (s: Pick) => void) {
    return (
      <section aria-labelledby={`h-${title}`} className="grid gap-4">
        <h2 id={`h-${title}`} className="m-0">{title}</h2>
        {data.items.length === 0 && <EmptyState title="No flights found" description="Try other dates, another cabin or a wider price range." />}
        {data.items.map(f => (
          <FlightCard key={f.flightId} flight={f}
            selectedCabinId={selected?.flightId === f.flightId ? selected.cabinId : undefined}
            onSelectCabin={(fl, cabin) => set({ flightId: fl.flightId, cabinId: cabin.cabinId })} />
        ))}
      </section>
    );
  }

  const pageSource = result?.kind === 'one' ? result.page : result?.kind === 'round' ? result.data.outbound : null;
  const totalPages = pageSource ? Math.max(pagesFor(pageSource), result?.kind === 'round' ? pagesFor(result.data.return) : 1) : 1;
  const ready = criteria.roundTrip ? Boolean(outbound && inbound) : Boolean(outbound);

  return (
    <div className="stack">
      {controls}
      {loading && <LoadingState label="Searching flights…" />}
      {error && <ErrorAlert message={error} title="Search failed" />}
      {!loading && !error && result?.kind === 'one' && renderList('Flights', result.page, outbound, setOutbound)}
      {!loading && !error && result?.kind === 'round' && (
        <>
          {renderList('Outbound flights', result.data.outbound, outbound, setOutbound)}
          {renderList('Return flights', result.data.return, inbound, setInbound)}
        </>
      )}
      {!loading && !error && totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
          <Button variant="secondary" disabled={page <= 1} onClick={() => go({ page: String(page - 1) })}>Previous</Button>
          <span className="text-sm text-muted">Page {page} of {totalPages}</span>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => go({ page: String(page + 1) })}>Next</Button>
        </nav>
      )}
      {ready && (
        <div className="sticky bottom-4 flex justify-end">
          <Button onClick={() => router.push(bookingUrl())}>Continue to booking</Button>
        </div>
      )}
    </div>
  );
}
