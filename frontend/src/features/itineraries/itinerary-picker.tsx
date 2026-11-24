'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
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

/**
 * Person 7 → Hicham (BLG-13). Lists the signed-in traveler's own itineraries from the real
 * paginated API (no client-side merging of pages). Private or hidden ones are shown but
 * disabled with the reason, so the author knows how to make one attachable.
 * `onChange(null, null)` means "no itinerary" (send `itineraryId: null` to detach).
 * The backend re-checks ownership/visibility on save; handle its 400 on `itineraryId`.
 */
export function ItineraryPicker({ value, onChange, disabled = false }: {
  value?: string | null;
  onChange: (itineraryId: string | null, itinerary: ItinerarySummary | null) => void;
  disabled?: boolean;
}) {
  const name = useId();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ItineraryPage | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    apiClient<ItineraryPage>(`/itineraries?page=${page}`, { signal: controller.signal })
      .then(setData)
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Your itineraries could not be loaded.'); });
    return () => controller.abort();
  }, [page, attempt]);

  if (error) return <div className="grid gap-2"><ErrorAlert title="Itineraries unavailable" message={error} /><div><Button variant="secondary" onClick={() => setAttempt(n => n + 1)}>Try again</Button></div></div>;
  if (!data) return <LoadingState label="Loading your itineraries…" />;
  if (data.total === 0) {
    return <EmptyState title="You have no itineraries yet" description="Create one and make it public to attach it to a post." action={<Link href="/itineraries/new">Create an itinerary</Link>} />;
  }

  return (
    <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0" disabled={disabled}>
      <legend className="mb-1 p-0 text-sm font-semibold text-ink">Attach an itinerary (optional)</legend>
      <p className="m-0 text-sm text-muted">Only your public itineraries can be attached.</p>
      <label className="flex min-h-11 items-center gap-3 rounded-control border border-border bg-card px-3">
        <input type="radio" name={name} className="size-5 accent-primary" checked={!value} onChange={() => onChange(null, null)} />
        <span>No itinerary</span>
      </label>
      {data.items.map(itinerary => {
        const allowed = isAttachable(itinerary);
        return (
          <label key={itinerary.itineraryId} className={`flex min-h-11 items-start gap-3 rounded-control border border-border bg-card px-3 py-2 ${allowed ? '' : 'opacity-70'}`}>
            <input
              type="radio" name={name} className="mt-1 size-5 accent-primary"
              value={itinerary.itineraryId} checked={value === itinerary.itineraryId} disabled={!allowed}
              onChange={() => onChange(itinerary.itineraryId, itinerary)}
            />
            <span className="grid">
              <span className="font-semibold">{itinerary.title}</span>
              <span className="text-sm text-muted">
                {formatDateRange(itinerary.startDate, itinerary.endDate)} · {pluralize(itinerary.dayCount, 'day')}
                {!allowed && (itinerary.isHidden ? ' · Hidden by an administrator' : ' · Private: make it public to attach')}
              </span>
            </span>
          </label>
        );
      })}
      {data.totalPages > 1 && (
        <div className="flex items-center justify-between gap-3">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-sm text-muted">Page {data.page} of {data.totalPages}</span>
          <Button variant="secondary" disabled={page >= data.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}
    </fieldset>
  );
}
