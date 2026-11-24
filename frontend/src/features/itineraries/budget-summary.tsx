'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { FormField } from '@/components/ui/form-field';
import { LoadingState } from '@/components/ui/loading-state';
import { ApiError } from '@/lib/api/client';
import { getBudgetSummary } from './api';
import { CurrencySelect } from './budget-editor';
import { categoryLabels, formatDateOnly, formatDayDate, money } from './format';
import { BUDGET_CATEGORIES, type BudgetSummary } from './types';
import { useItineraryCatalog } from './use-catalog';

type State = { kind: 'loading' } | { kind: 'ok'; summary: BudgetSummary } | { kind: 'error'; message: string };

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 503) return 'Exchange rates are temporarily unavailable and none are cached yet. Try again later.';
    if (error.status === 422) return `${error.message}. Choose another display currency.`;
    return error.message;
  }
  return 'The budget could not be loaded.';
}

/**
 * ITN-14/ITN-18 totals, converted by the backend with daily cached rates. `refreshKey`
 * changes after every saved edit so totals are re-read, never recomputed in the browser.
 * Booking prices linked to days keep their own currency in the breakdown (PAY-04).
 */
export function BudgetSummaryPanel({ itineraryId, refreshKey, onLoaded }: {
  itineraryId: string;
  refreshKey: string;
  onLoaded?: (summary: BudgetSummary | null) => void;
}) {
  const { currencies } = useItineraryCatalog();
  const [currency, setCurrency] = useState<string | undefined>(undefined);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState(current => (current.kind === 'ok' ? current : { kind: 'loading' }));
    getBudgetSummary(itineraryId, currency, controller.signal)
      .then(summary => { setState({ kind: 'ok', summary }); onLoaded?.(summary); })
      .catch(error => {
        if (controller.signal.aborted) return;
        setState({ kind: 'error', message: describe(error) });
        onLoaded?.(null);
      });
    return () => controller.abort();
    // onLoaded is a callback prop and deliberately not a dependency: re-reading on its identity would loop.
  }, [itineraryId, currency, refreshKey, attempt]);

  const summary = state.kind === 'ok' ? state.summary : null;
  const shown = currency ?? summary?.currency ?? '';

  return (
    <section aria-labelledby="budget-heading" className="grid gap-4 rounded-card border border-border bg-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="budget-heading" className="m-0 text-xl">Budget</h2>
        {shown && currencies.length > 0 && (
          <div className="w-full">
            <FormField id={`budget-currency-${itineraryId}`} label="Show totals in">
              <CurrencySelect value={shown} currencies={currencies} onChange={setCurrency} />
            </FormField>
          </div>
        )}
      </div>
      {state.kind === 'loading' && <LoadingState label="Calculating budget…" />}
      {state.kind === 'error' && (
        <div className="grid gap-3">
          <ErrorAlert title="Budget unavailable" message={state.message} />
          <div><Button variant="secondary" onClick={() => setAttempt(value => value + 1)}>Try again</Button></div>
        </div>
      )}
      {summary && (
        <div className="grid gap-4" aria-live="polite">
          <div>
            <p className="m-0 text-sm text-muted">Grand total</p>
            <p className="m-0 font-heading text-3xl font-bold text-ink" data-testid="grand-total">{money(summary.totals.grandTotal, summary.currency)}</p>
            <p className="m-0 mt-1 text-sm text-muted">
              {summary.rateDate ? `Converted with rates from ${formatDateOnly(summary.rateDate.slice(0, 10))}.` : 'No conversion needed.'}
            </p>
          </div>
          {summary.ratesStale && (
            <p role="note" className="m-0 rounded-control border border-sand/50 bg-sand/20 px-3 py-2 text-sm text-ink">
              The rate provider is unavailable, so the last saved rates were used. Totals may be slightly out of date.
            </p>
          )}
          <dl className="m-0 grid grid-cols-2 gap-3">
            {BUDGET_CATEGORIES.map(category => (
              <div key={category} className="rounded-control border border-border p-3">
                <dt className="text-xs text-muted">{categoryLabels[category]}</dt>
                <dd className="m-0 font-semibold">{money(summary.totals.categories[category], summary.currency)}</dd>
              </div>
            ))}
            <div className="rounded-control border border-border p-3">
              <dt className="text-xs text-muted">Intercity transport</dt>
              <dd className="m-0 font-semibold">{money(summary.totals.transport, summary.currency)}</dd>
            </div>
            <div className="rounded-control border border-primary/30 bg-primary/5 p-3">
              <dt className="text-xs text-muted">Daily total</dt>
              <dd className="m-0 font-semibold">{money(summary.totals.daily, summary.currency)}</dd>
            </div>
          </dl>
          {summary.byDay.length > 0 && (
            <details className="group">
              <summary className="min-h-11 cursor-pointer py-2 font-semibold text-ink">Totals by day and city stop</summary>
              <div className="grid gap-4 pt-2">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] border-collapse text-sm">
                    <caption className="sr-only">Budget by day in {summary.currency}</caption>
                    <thead>
                      <tr className="border-b border-border text-left text-muted">
                        <th scope="col" className="py-2 pr-3 font-semibold">Day</th>
                        <th scope="col" className="py-2 pr-3 font-semibold">City</th>
                        <th scope="col" className="py-2 pr-3 text-right font-semibold">Daily</th>
                        <th scope="col" className="py-2 pr-3 text-right font-semibold">Transport</th>
                        <th scope="col" className="py-2 text-right font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.byDay.map(day => (
                        <tr key={day.dayId} className="border-b border-border">
                          <th scope="row" className="py-2 pr-3 text-left font-normal">Day {day.dayNumber} · {formatDayDate(day.date)}</th>
                          <td className="py-2 pr-3">{day.city}</td>
                          <td className="py-2 pr-3 text-right">{money(day.total - day.transport, summary.currency)}</td>
                          <td className="py-2 pr-3 text-right">{money(day.transport, summary.currency)}</td>
                          <td className="py-2 text-right font-semibold">{money(day.total, summary.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="m-0 grid list-none gap-2 p-0 text-sm">
                  {summary.byCity.map(stop => (
                    <li key={`${stop.firstDayNumber}-${stop.city}`} className="flex justify-between gap-3">
                      <span>{stop.city} · {stop.firstDayNumber === stop.lastDayNumber ? `day ${stop.firstDayNumber}` : `days ${stop.firstDayNumber}–${stop.lastDayNumber}`}</span>
                      <span className="font-semibold">{money(stop.total, summary.currency)}</span>
                    </li>
                  ))}
                </ul>
                {summary.linkedBookings && summary.linkedBookings.length > 0 && (
                  <div className="grid gap-1 text-sm">
                    <p className="m-0 font-semibold text-ink">Linked bookings</p>
                    <ul className="m-0 grid list-none gap-1 p-0">
                      {summary.linkedBookings.map(link => (
                        <li key={link.linkedBookingId} className="flex justify-between gap-3">
                          <span>{link.label ?? link.type}{!link.countsInBudget && <span className="text-muted"> · not counted</span>}</span>
                          <span className="font-semibold">{money(link.convertedAmount, summary.currency)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {summary.originalTotals.length > 0 && (
                  <p className="m-0 text-xs text-muted">
                    As entered: {summary.originalTotals.map(total => money(total.amount, total.currency)).join(' + ')}
                  </p>
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
