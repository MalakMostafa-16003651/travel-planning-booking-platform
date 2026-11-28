'use client';

import { useEffect, useId, useState } from 'react';
import { Pagination } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/error-alert';
import { LoadingState } from '@/components/ui/loading-state';
import { apiClient } from '@/lib/api/client';
import { formatDateRange, pluralize } from './format';
import type { ItineraryPage, ItinerarySummary } from './types';

/** BLG-13 rule (backend `assertAttachableItinerary`): only your own PUBLIC, not hidden, itinerary. */
export function isAttachable(itinerary: ItinerarySummary): boolean {
  return itinerary.visibility === 'PUBLIC' && !itinerary.isHidden;
}

const titleClass = 'min-w-0 font-semibold [overflow-wrap:anywhere]';

/**
 * Person 7 → Hicham (BLG-13). Lists the signed-in traveler's own itineraries from the real
 * paginated API (no client-side merging of pages). Private or hidden ones are shown but
 * disabled with the reason, so the author knows how to make one attachable.
 *
 * - `onChange(null, null)` means "no itinerary" (send `itineraryId: null` to detach).
 * - `selected`: the summary of the current choice (e.g. the post's saved `itinerary`), so it
 *   stays visible and checked when it is not on the page being shown.
 * - `error`: the backend's 400 message for `itineraryId`. It is shown under the legend, and the
 *   current page is re-read so a trip that just became private or hidden is no longer offered.
 */
export function ItineraryPicker({ value, selected = null, onChange, disabled = false, error = '' }: {
  value?: string | null;
  selected?: ItinerarySummary | null;
  onChange: (itineraryId: string | null, itinerary: ItinerarySummary | null) => void;
  disabled?: boolean;
  error?: string;
}) {
  const name = useId();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ItineraryPage | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    apiClient<ItineraryPage>(`/itineraries?page=${page}`, { signal: controller.signal })
      .then(setData)
      .catch(cause => { if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : 'Your itineraries could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // A new server error re-reads the page so stale visibility is not offered again.
  }, [page, attempt, error]);

  const describedBy = [`${name}-hint`, error ? `${name}-error` : ''].filter(Boolean).join(' ');
  const onPage = Boolean(value && data?.items.some(item => item.itineraryId === value));
  const current = value && !onPage ? (selected?.itineraryId === value ? selected : null) : null;

  return (
    <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0" disabled={disabled} aria-describedby={describedBy} aria-busy={loading}>
      <legend className="mb-1 p-0 text-sm font-semibold text-ink">Attach an itinerary (optional)</legend>
      <p id={`${name}-hint`} className="m-0 text-sm text-muted">Only your public itineraries can be attached.</p>
      {error && <p id={`${name}-error`} role="alert" className="m-0 text-sm text-danger">{error}</p>}

      {/* Always available, even while loading or after a load error. */}
      <label className="flex min-h-11 items-center gap-3 rounded-control border border-border bg-card px-3">
        <input type="radio" name={name} className="size-5 accent-primary" checked={!value} onChange={() => onChange(null, null)} />
        <span>No itinerary</span>
      </label>

      {value && !onPage && (
        <label className="flex min-h-11 items-start gap-3 rounded-control border border-primary/40 bg-primary/5 px-3 py-2">
          <input type="radio" name={name} className="mt-1 size-5 accent-primary" checked readOnly />
          <span className="grid min-w-0">
            <span className={titleClass}>{current?.title ?? 'Your current itinerary'}</span>
            <span className="text-sm text-muted">
              {current && `${formatDateRange(current.startDate, current.endDate)} · ${pluralize(current.dayCount, 'day')} · `}
              Current choice{data && data.totalPages > 1 ? ', on another page' : ''}
            </span>
          </span>
        </label>
      )}

      {loadError && (
        <div className="grid gap-2">
          <ErrorAlert title="Itineraries unavailable" message={loadError} />
          <div><Button variant="secondary" onClick={() => setAttempt(n => n + 1)}>Try again</Button></div>
        </div>
      )}
      {!data && !loadError && <LoadingState label="Loading your itineraries…" />}
      {data && data.total === 0 && (
        <EmptyState
          title="You have no itineraries yet"
          description="Create one and make it public to attach it to a post."
          action={<a href="/itineraries/new" target="_blank" rel="noopener noreferrer">Create an itinerary (opens in a new tab)</a>}
        />
      )}
      {data && data.items.map(itinerary => {
        const allowed = isAttachable(itinerary);
        return (
          <label key={itinerary.itineraryId} className={`flex min-h-11 items-start gap-3 rounded-control border border-border bg-card px-3 py-2 ${allowed ? '' : 'opacity-70'}`}>
            <input
              type="radio" name={name} className="mt-1 size-5 accent-primary"
              value={itinerary.itineraryId} checked={value === itinerary.itineraryId} disabled={!allowed || loading}
              onChange={() => onChange(itinerary.itineraryId, itinerary)}
            />
            <span className="grid min-w-0">
              <span className={titleClass}>{itinerary.title}</span>
              <span className="text-sm text-muted">
                {formatDateRange(itinerary.startDate, itinerary.endDate)} · {pluralize(itinerary.dayCount, 'day')}
                {!allowed && (itinerary.isHidden ? ' · Hidden by an administrator' : ' · Private: make it public to attach')}
              </span>
            </span>
          </label>
        );
      })}
      {data && (
        <Pagination page={data.page} totalPages={data.totalPages} onPageChange={setPage} disabled={loading} label="Your itinerary pages" />
      )}
      {loading && data && <p role="status" className="m-0 text-sm text-muted">Loading…</p>}
    </fieldset>
  );
}
