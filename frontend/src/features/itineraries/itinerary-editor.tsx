'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClassName } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorAlert } from '@/components/ui/error-alert';
import { useDestinations } from '@/features/hotels/hotel-search/use-destinations';
import { ApiError } from '@/lib/api/client';
import { ActivityEditor } from './activity-editor';
import * as api from './api';
import { BudgetEditor } from './budget-editor';
import { BudgetSummaryPanel } from './budget-summary';
import { DayListEditor } from './day-list-editor';
import { formatDateRange, money, pluralize, visibilityLabels } from './format';
import { ItineraryForm } from './itinerary-form';
import { LinkedBookingsEditor } from './linked-bookings-editor';
import { PdfExport } from './pdf-export';
import { TransportEditor } from './transport-editor';
import type { BudgetSummary, Itinerary } from './types';
import { useItineraryCatalog } from './use-catalog';

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; message: string } | { kind: 'error'; message: string; conflict: boolean };

function describe(error: unknown): { message: string; conflict: boolean } {
  if (error instanceof ApiError) {
    if (error.status === 409) return { message: error.message || 'This itinerary was changed elsewhere. Reload to see the latest version.', conflict: true };
    if (error.status === 401) return { message: 'Your session has ended. Sign in again to keep editing; unsaved text is kept on this page.', conflict: false };
    if (error.status === 404) return { message: 'This itinerary no longer exists or is not yours.', conflict: false };
    const field = Object.values(error.fields).flat()[0];
    return { message: field || error.message, conflict: false };
  }
  return { message: 'Something went wrong. Please try again.', conflict: false };
}

/**
 * ITN-01/05/07/08/09/20 owner editor. The server is the only source of day numbers, dates
 * and city groups: each mutation response replaces local state, so nothing is recomputed here.
 */
export function ItineraryEditor({ initial, notice }: { initial: Itinerary; notice?: string }) {
  const router = useRouter();
  const { cities, countries, error: catalogError } = useDestinations();
  const [itinerary, setItinerary] = useState(initial);
  const [state, setState] = useState<SaveState>(notice ? { kind: 'saved', message: notice } : { kind: 'idle' });
  const [editingDetails, setEditingDetails] = useState(false);
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const { currencies, attractions, error: currencyError } = useItineraryCatalog();
  const groupTotals = Object.fromEntries((summary?.byCity ?? []).map(stop => [stop.firstDayNumber, money(stop.total, summary!.currency)]));
  const cityIdOf = (name: string, countryCode?: string) => cities.find(city => city.name === name && (!countryCode || city.countryCode === countryCode))?.cityId;
  const running = useRef(false);
  const busy = state.kind === 'saving';
  const countryNames = Object.fromEntries(countries.map(country => [country.code, country.name]));
  const usedCountries = [...new Set(itinerary.days.map(day => day.countryCode).filter((code): code is string => Boolean(code)))];

  /** One mutation at a time: avoids double submission and out-of-order responses. */
  async function run(request: () => Promise<Itinerary>, success: string): Promise<boolean> {
    if (running.current) return false;
    running.current = true;
    setState({ kind: 'saving' });
    try {
      setItinerary(await request());
      setState({ kind: 'saved', message: success });
      return true;
    } catch (error) {
      setState({ kind: 'error', ...describe(error) });
      return false;
    } finally {
      running.current = false;
    }
  }

  const id = itinerary.itineraryId;
  const makePublic = itinerary.visibility === 'PRIVATE';

  return (
    <div className="stack">
      <header className="grid gap-3">
        <Link href="/itineraries" className="text-sm">Your itineraries</Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-2">
            <h1 className="m-0 break-words">{itinerary.title}</h1>
            <p className="m-0 text-muted">
              {itinerary.countries.map(code => countryNames[code] ?? code).join(', ')}
              {' · '}{formatDateRange(itinerary.startDate, itinerary.endDate)}
              {' · '}{itinerary.dayCount === 0 ? 'No days yet' : pluralize(itinerary.dayCount, 'day')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge tone={itinerary.visibility === 'PUBLIC' ? 'info' : 'neutral'}>{visibilityLabels[itinerary.visibility]}</Badge>
              {itinerary.isHidden && <Badge tone="warning">Hidden by an administrator</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {itinerary.days.length > 0 && <Link href={`/itineraries/${encodeURIComponent(id)}/flights`} className={buttonClassName('secondary')}>Find flights to {itinerary.days[0].city}</Link>}
            <Link href={`/itineraries/${encodeURIComponent(id)}`} className={buttonClassName('secondary')}>View itinerary</Link>
          </div>
          <div className="w-full"><PdfExport itineraryId={id} title={itinerary.title} /></div>
        </div>
      </header>

      <div aria-live="polite" role="status" className="min-h-6 text-sm">
        {state.kind === 'saving' && <span className="text-muted">Saving…</span>}
        {state.kind === 'saved' && <span className="text-success">{state.message}</span>}
      </div>
      {state.kind === 'error' && (
        <div className="grid gap-3">
          <ErrorAlert message={state.message} />
          {state.conflict && <div><Button variant="secondary" onClick={() => window.location.reload()}>Reload latest version</Button></div>}
        </div>
      )}
      {catalogError && <ErrorAlert title="City list unavailable" message={catalogError} />}
      {currencyError && <ErrorAlert title="Currency list unavailable" message={currencyError} />}

      <Card className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-xl">Trip details</h2>
          {!editingDetails && <Button variant="secondary" disabled={busy} onClick={() => setEditingDetails(true)}>Edit details</Button>}
        </div>
        {editingDetails ? (
          <ItineraryForm
            mode="edit"
            initial={{ title: itinerary.title, description: itinerary.description ?? '', countries: itinerary.countries, startDate: itinerary.startDate, visibility: itinerary.visibility }}
            lockedCountries={usedCountries}
            submitLabel="Save details"
            onCancel={() => setEditingDetails(false)}
            onSubmit={async input => {
              const saved = await api.updateItinerary(id, input);
              setItinerary(saved);
              setState({ kind: 'saved', message: 'Trip details saved.' });
              setEditingDetails(false);
              return saved;
            }}
          />
        ) : (
          itinerary.description ? <p className="m-0 whitespace-pre-line">{itinerary.description}</p> : <p className="m-0 text-muted">No description.</p>
        )}
      </Card>

      <Card className="grid gap-3">
        <h2 className="m-0 text-xl">Visibility</h2>
        <p className="m-0">
          {makePublic
            ? 'This itinerary is private: only you can see it.'
            : 'This itinerary is public: anyone can find it and view it read-only, and signed-in travelers can clone it.'}
        </p>
        {!makePublic && !itinerary.isHidden && <p className="m-0"><Link href={`/explore/itineraries/${encodeURIComponent(id)}`}>Open the public page</Link></p>}
        <div>
          <ConfirmDialog
            triggerLabel={makePublic ? 'Make public' : 'Make private'}
            title={makePublic ? 'Make this itinerary public?' : 'Make this itinerary private?'}
            description={makePublic
              ? 'It will appear in public itinerary search, read-only for others. Booking links are never shown to other viewers.'
              : 'It is removed from public search immediately and others can no longer open it. Copies others already cloned stay theirs.'}
            confirmLabel={makePublic ? 'Make public' : 'Make private'}
            variant="primary"
            disabled={busy}
            onConfirm={async () => {
              const ok = await run(() => api.updateItinerary(id, { visibility: makePublic ? 'PUBLIC' : 'PRIVATE' }), makePublic ? 'Itinerary is now public.' : 'Itinerary is now private.');
              if (!ok) throw new Error('The visibility could not be changed. See the message on the page.');
            }}
          />
        </div>
      </Card>

      {/* Day/city hierarchy with a side budget on wide screens (team layout rule); stacked on phones. */}
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
        <div className="grid min-w-0 gap-8">
          <section aria-labelledby="days-heading" className="grid gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="days-heading" className="m-0 text-xl">Days</h2>
              <p className="m-0 text-sm text-muted">{itinerary.days.length} of 60 days</p>
            </div>
            <DayListEditor
              itinerary={itinerary}
              cities={cities}
              busy={busy}
              actions={{
                add: input => run(() => api.addDay(id, input), 'Day added.'),
                update: (dayId, input) => run(() => api.updateDay(id, dayId, input), 'Day saved.'),
                remove: async dayId => {
                  const ok = await run(() => api.deleteDay(id, dayId), 'Day deleted. Later days and totals were recalculated.');
                  if (!ok) throw new Error('The day could not be deleted. See the message on the page.');
                },
                reorder: (dayIds, announcement) => run(() => api.reorderDays(id, dayIds), announcement),
              }}
              groupTotals={groupTotals}
              renderDayDetails={day => (
                <>
                  <ActivityEditor
                    itineraryId={id}
                    day={day}
                    cityId={cityIdOf(day.city, day.countryCode)}
                    attractions={attractions}
                    currencies={currencies}
                    defaultCurrency={itinerary.currency}
                    busy={busy}
                    mutate={run}
                    apply={updated => { setItinerary(updated); setState({ kind: 'saved', message: 'Photos updated.' }); }}
                  />
                  <BudgetEditor itineraryId={id} day={day} currencies={currencies} defaultCurrency={itinerary.currency} busy={busy} mutate={run} />
                </>
              )}
            />
          </section>

          <section aria-labelledby="transport-heading" className="grid gap-4">
            <div>
              <h2 id="transport-heading" className="m-0 text-xl">Intercity transport</h2>
              <p className="m-0 mt-1 text-sm text-muted">Trains, flights or drives between cities. Each cost is counted on its travel day.</p>
            </div>
            <TransportEditor itinerary={itinerary} cities={cities} currencies={currencies} busy={busy} mutate={run} />
        </section>

        <section aria-labelledby="linked-heading" className="grid gap-4">
          <div>
            <h2 id="linked-heading" className="m-0 text-xl">Your booked flights and hotels</h2>
            <p className="m-0 mt-1 text-sm text-muted">Link your confirmed bookings to the right day. Only you see them; they are never shown to others or copied into clones.</p>
          </div>
          <LinkedBookingsEditor itinerary={itinerary} busy={busy} mutate={run} />
          </section>
        </div>
        <aside className="min-w-0 lg:sticky lg:top-6" aria-label="Budget summary">
          <BudgetSummaryPanel itineraryId={id} refreshKey={itinerary.updatedAt} onLoaded={setSummary} />
        </aside>
      </div>

      <Card className="grid gap-3 border-danger/40">
        <h2 className="m-0 text-xl">Delete itinerary</h2>
        <p className="m-0 text-sm text-muted">Deletes every day, activity, image and budget entry. Copies that other travelers cloned are not affected.</p>
        <div>
          <ConfirmDialog
            triggerLabel="Delete itinerary"
            title="Delete this itinerary?"
            description={`“${itinerary.title}” and all of its days will be permanently deleted${itinerary.visibility === 'PUBLIC' ? ' and removed from public search' : ''}. This cannot be undone.`}
            confirmLabel="Delete itinerary"
            pendingLabel="Deleting…"
            disabled={busy}
            onConfirm={async () => {
              try {
                await api.deleteItinerary(id);
              } catch (error) {
                throw new Error(describe(error).message);
              }
              router.replace('/itineraries?deleted=1');
              router.refresh();
            }}
          />
        </div>
      </Card>
    </div>
  );
}
