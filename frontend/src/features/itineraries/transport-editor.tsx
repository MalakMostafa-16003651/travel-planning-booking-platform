'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { City } from '@/features/hotels/hotel-search/use-destinations';
import type { Mutate } from './activity-editor';
import * as api from './api';
import { CurrencySelect } from './budget-editor';
import { formatDayDate, money, parseAmount, transportLabels } from './format';
import { TRANSPORT_MODES, type Itinerary, type TransportCost, type TransportMode } from './types';
import type { Currency } from './use-catalog';

interface Draft { fromCity: string; toCity: string; mode: TransportMode; amount: string; currency: string; dayId: string; notes: string }
type Errors = Partial<Record<'fromCity' | 'toCity' | 'amount' | 'dayId' | 'notes', string>>;

/**
 * ITN-16 intercity transport. Cities may be any official catalog city (e.g. travelling from
 * home), matching the backend rule; each cost belongs to one travel day.
 */
export function TransportEditor({ itinerary, cities, currencies, busy, mutate }: {
  itinerary: Itinerary;
  cities: City[];
  currencies: Currency[];
  busy: boolean;
  mutate: Mutate;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const sortedCities = [...cities].sort((a, b) => a.name.localeCompare(b.name));
  const toInput = (draft: Draft): api.TransportInput => ({
    fromCity: draft.fromCity, toCity: draft.toCity, mode: draft.mode, amount: parseAmount(draft.amount)!,
    currency: draft.currency, dayId: draft.dayId, notes: draft.notes.trim(),
  });

  if (itinerary.days.length === 0) {
    return <p className="m-0 text-sm text-muted">Add a day first: every transport cost belongs to a travel day.</p>;
  }

  return (
    <div className="grid gap-3">
      {itinerary.transportCosts.length === 0 && !adding && <p className="m-0 text-sm text-muted">No intercity transport yet.</p>}
      <ul className="m-0 grid list-none gap-2 p-0">
        {itinerary.transportCosts.map(cost => (
          <li key={cost.transportCostId} className="rounded-control border border-border bg-card p-3">
            {editing === cost.transportCostId ? (
              <TransportForm
                idPrefix={`transport-${cost.transportCostId}`}
                initial={draftOf(cost, itinerary)}
                itinerary={itinerary}
                cities={sortedCities}
                currencies={currencies}
                busy={busy}
                submitLabel="Save transport"
                onCancel={() => setEditing(null)}
                onSubmit={async draft => {
                  const ok = await mutate(() => api.updateTransportCost(cost.transportCostId, toInput(draft)), 'Transport saved.');
                  if (ok) setEditing(null);
                }}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 font-semibold text-ink">{cost.fromCity} → {cost.toCity} · {transportLabels[cost.mode]} · {money(cost.amount, cost.currency)}</p>
                  <p className="m-0 text-sm text-muted">
                    {cost.dayNumber ? `Day ${cost.dayNumber}${cost.date ? ` · ${formatDayDate(cost.date)}` : ''}` : 'Its day was deleted'}
                    {cost.notes && ` · ${cost.notes}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" disabled={busy} onClick={() => setEditing(cost.transportCostId)} aria-label={`Edit transport ${cost.fromCity} to ${cost.toCity}`}>Edit</Button>
                  <ConfirmDialog
                    triggerLabel="Delete transport"
                    title="Delete this transport cost?"
                    description={`${cost.fromCity} → ${cost.toCity}, ${money(cost.amount, cost.currency)}. Totals are recalculated.`}
                    confirmLabel="Delete transport"
                    pendingLabel="Deleting…"
                    disabled={busy}
                    onConfirm={async () => {
                      if (!(await mutate(() => api.deleteTransportCost(cost.transportCostId), 'Transport deleted.'))) throw new Error('The transport cost could not be deleted. See the message on the page.');
                    }}
                  />
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="rounded-control border border-dashed border-border p-3">
          <TransportForm
            idPrefix="new-transport"
            initial={draftOf(undefined, itinerary)}
            itinerary={itinerary}
            cities={sortedCities}
            currencies={currencies}
            busy={busy}
            submitLabel="Add transport"
            onCancel={() => setAdding(false)}
            onSubmit={async draft => {
              const input = toInput(draft);
              if (!input.notes) delete input.notes;
              const ok = await mutate(() => api.addTransportCost(itinerary.itineraryId, input), 'Transport added.');
              if (ok) setAdding(false);
            }}
          />
        </div>
      ) : (
        <div><Button variant="secondary" disabled={busy} onClick={() => setAdding(true)}>Add intercity transport</Button></div>
      )}
    </div>
  );
}

function draftOf(cost: TransportCost | undefined, itinerary: Itinerary): Draft {
  return {
    fromCity: cost?.fromCity ?? '',
    toCity: cost?.toCity ?? '',
    mode: cost?.mode ?? 'TRAIN',
    amount: cost ? String(cost.amount) : '',
    currency: cost?.currency ?? itinerary.currency,
    dayId: cost?.dayId ?? '',
    notes: cost?.notes ?? '',
  };
}

function TransportForm({ idPrefix, initial, itinerary, cities, currencies, busy, submitLabel, onSubmit, onCancel }: {
  idPrefix: string;
  initial: Draft;
  itinerary: Itinerary;
  cities: City[];
  currencies: Currency[];
  busy: boolean;
  submitLabel: string;
  onSubmit: (draft: Draft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft(current => ({ ...current, [key]: value }));
    setErrors(current => ({ ...current, [key]: undefined }));
  };
  const cityOptions = (selected: string) => (
    <>
      <option value="">Choose a city</option>
      {cities.map(city => <option key={city.cityId} value={city.name}>{city.name}</option>)}
      {selected && !cities.some(city => city.name === selected) && <option value={selected}>{selected}</option>}
    </>
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const found: Errors = {
      fromCity: draft.fromCity ? undefined : 'Choose where you leave from.',
      toCity: !draft.toCity ? 'Choose where you arrive.' : draft.toCity === draft.fromCity ? 'Choose a different city.' : undefined,
      amount: parseAmount(draft.amount) === null ? 'Enter a non-negative amount with at most two decimals.' : undefined,
      dayId: draft.dayId ? undefined : 'Choose the travel day.',
      notes: draft.notes.trim().length > 500 ? 'Notes must be at most 500 characters.' : undefined,
    };
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    await onSubmit(draft);
  }

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <div className="grid items-start gap-4 sm:grid-cols-3">
        <FormField id={`${idPrefix}-from`} label="From city" error={errors.fromCity}>
          <Select value={draft.fromCity} onChange={event => set('fromCity', event.target.value)}>{cityOptions(draft.fromCity)}</Select>
        </FormField>
        <FormField id={`${idPrefix}-to`} label="To city" error={errors.toCity}>
          <Select value={draft.toCity} onChange={event => set('toCity', event.target.value)}>{cityOptions(draft.toCity)}</Select>
        </FormField>
        <FormField id={`${idPrefix}-mode`} label="Mode">
          <Select value={draft.mode} onChange={event => set('mode', event.target.value as TransportMode)}>
            {TRANSPORT_MODES.map(mode => <option key={mode} value={mode}>{transportLabels[mode]}</option>)}
          </Select>
        </FormField>
        <FormField id={`${idPrefix}-day`} label="Travel day" error={errors.dayId}>
          <Select value={draft.dayId} onChange={event => set('dayId', event.target.value)}>
            <option value="">Choose a day</option>
            {itinerary.days.map(day => <option key={day.dayId} value={day.dayId}>Day {day.dayNumber} · {formatDayDate(day.date)} · {day.city}</option>)}
          </Select>
        </FormField>
        <FormField id={`${idPrefix}-amount`} label="Amount" error={errors.amount}>
          <Input inputMode="decimal" value={draft.amount} onChange={event => set('amount', event.target.value)} />
        </FormField>
        <FormField id={`${idPrefix}-currency`} label="Currency">
          <CurrencySelect value={draft.currency} currencies={currencies} onChange={currency => set('currency', currency)} />
        </FormField>
      </div>
      <FormField id={`${idPrefix}-notes`} label="Notes (optional)" error={errors.notes}>
        <Input value={draft.notes} maxLength={500} onChange={event => set('notes', event.target.value)} />
      </FormField>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
