'use client';

import { useMemo, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';
import type { City } from '@/features/hotels/hotel-search/use-destinations';
import { formatDateRange, formatDayDate, pluralize } from './format';
import { ITINERARY_LIMITS, type Itinerary, type ItineraryDay } from './types';
import type { DayInput } from './api';

const textareaClass = 'min-h-20 w-full rounded-control border border-border bg-card px-3 py-2.5 text-base text-body aria-invalid:border-danger';

/** Value of a city <option>: "countryCode|name", since names alone are not unique worldwide. */
const cityKey = (city: { name: string; countryCode?: string }) => `${city.countryCode ?? ''}|${city.name}`;

function parseCityKey(value: string): DayInput | null {
  const [countryCode, city] = value.split('|');
  return city ? { city, countryCode: countryCode || undefined } : null;
}

export interface DayActions {
  add: (input: DayInput & { position?: number }) => Promise<boolean>;
  update: (dayId: string, input: Partial<DayInput>) => Promise<boolean>;
  remove: (dayId: string) => Promise<void>;
  reorder: (dayIds: string[], announcement: string) => Promise<boolean>;
}

/**
 * ITN-05/07/08/09 day editor. Days are shown in their city groups (consecutive days in the
 * same city, computed by the backend). Reordering has keyboard/screen-reader buttons; drag
 * and drop is only a pointer shortcut for the same request.
 */
export function DayListEditor({ itinerary, cities, busy, actions, renderDayDetails, groupTotals = {} }: {
  itinerary: Itinerary;
  cities: City[];
  busy: boolean;
  actions: DayActions;
  /** Activities/budget panel for one day (ITN-10/12/14). */
  renderDayDetails?: (day: ItineraryDay) => ReactNode;
  /** ITN-09: formatted backend subtotal per city group, keyed by its first day number. */
  groupTotals?: Record<number, string>;
}) {
  const allowedCities = useMemo(
    () => cities.filter(city => itinerary.countries.includes(city.countryCode)).sort((a, b) => a.name.localeCompare(b.name)),
    [cities, itinerary.countries],
  );
  const daysById = useMemo(() => new Map(itinerary.days.map(day => [day.dayId, day])), [itinerary.days]);
  const [editing, setEditing] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const ids = itinerary.days.map(day => day.dayId);

  function move(dayId: string, offset: -1 | 1) {
    const from = ids.indexOf(dayId);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const next = [...ids];
    [next[from], next[to]] = [next[to], next[from]];
    void actions.reorder(next, `Day moved to position ${to + 1}.`);
  }

  function drop(event: DragEvent, targetId: string) {
    event.preventDefault();
    const source = dragged;
    setDragged(null);
    if (!source || source === targetId) return;
    const next = ids.filter(id => id !== source);
    next.splice(next.indexOf(targetId) + (ids.indexOf(source) < ids.indexOf(targetId) ? 1 : 0), 0, source);
    void actions.reorder(next, `Day moved to position ${next.indexOf(source) + 1}.`);
  }

  return (
    <div className="grid gap-6">
      {itinerary.days.length === 0 ? (
        <EmptyState title="No days yet" description="Add your first day below. Dates are counted from the trip's start date." />
      ) : (
        <ol className="m-0 grid list-none gap-6 p-0" aria-label="Itinerary days grouped by city">
          {itinerary.cityGroups.map(group => (
            <li key={`${group.firstDayNumber}-${group.city}`} className="grid gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
                <h3 className="m-0 text-lg">{group.city}</h3>
                <p className="m-0 text-sm text-muted">
                  {group.dayCount === 1 ? `Day ${group.firstDayNumber}` : `Days ${group.firstDayNumber}–${group.lastDayNumber}`}
                  {' · '}{pluralize(group.dayCount, 'day')}{' · '}{formatDateRange(group.startDate, group.endDate)}
                  {groupTotals[group.firstDayNumber] && <>{' · '}<span className="font-semibold text-ink">Subtotal {groupTotals[group.firstDayNumber]}</span></>}
                </p>
                <Link href={`/itineraries/${encodeURIComponent(itinerary.itineraryId)}/hotels?dayId=${encodeURIComponent(group.dayIds[0])}`} className="w-full text-sm sm:w-auto">Find hotels for {group.city}</Link>
              </div>
              <ol className="m-0 grid list-none gap-3 p-0">
                {group.dayIds.map(dayId => {
                  const day = daysById.get(dayId);
                  if (!day) return null;
                  return (
                    <li
                      key={day.dayId}
                      onDragOver={event => { if (dragged) event.preventDefault(); }}
                      onDrop={event => drop(event, day.dayId)}
                      className={`rounded-card border bg-card p-4 ${dragged === day.dayId ? 'border-primary opacity-60' : 'border-border'}`}
                    >
                      {editing === day.dayId ? (
                        <DayForm
                          idPrefix={`day-${day.dayId}`}
                          cities={allowedCities}
                          initial={day}
                          submitLabel="Save day"
                          busy={busy}
                          onCancel={() => setEditing(null)}
                          onSubmit={async input => {
                            const changes: Partial<DayInput> = { notes: input.notes ?? '' };
                            if (input.city !== day.city || input.countryCode !== day.countryCode) Object.assign(changes, { city: input.city, countryCode: input.countryCode });
                            const ok = await actions.update(day.dayId, changes);
                            if (ok) setEditing(null);
                            return ok;
                          }}
                        />
                      ) : (
                        <>
                        <DayRow
                          day={day}
                          busy={busy}
                          isFirst={day.dayNumber === 1}
                          isLast={day.dayNumber === itinerary.days.length}
                          onDragStart={() => setDragged(day.dayId)}
                          onDragEnd={() => setDragged(null)}
                          onMove={offset => move(day.dayId, offset)}
                          onEdit={() => setEditing(day.dayId)}
                          onDelete={() => actions.remove(day.dayId)}
                        />
                        {renderDayDetails && (
                          <details className="mt-3 border-t border-border pt-3">
                            <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-primary">
                              Activities and budget for day {day.dayNumber} ({pluralize(day.activities.length, 'activity', 'activities')}, {pluralize(day.budgets.length, 'entry', 'entries')})
                            </summary>
                            <div className="grid gap-6 pt-3">{renderDayDetails(day)}</div>
                          </details>
                        )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
        </ol>
      )}

      <section aria-labelledby="add-day-heading" className="grid gap-3 rounded-card border border-dashed border-border bg-canvas p-4">
        <h3 id="add-day-heading" className="m-0 text-lg">Add a day</h3>
        {itinerary.days.length >= ITINERARY_LIMITS.days ? (
          <p className="m-0 text-sm text-muted">This itinerary has reached the {ITINERARY_LIMITS.days}-day limit. Delete a day to add another.</p>
        ) : allowedCities.length === 0 ? (
          <p className="m-0 text-sm text-muted">No catalog cities are available for the selected countries.</p>
        ) : (
          <DayForm
            key={itinerary.days.length}
            idPrefix="new-day"
            cities={allowedCities}
            dayCount={itinerary.days.length}
            submitLabel="Add day"
            busy={busy}
            onSubmit={input => actions.add(input)}
          />
        )}
      </section>
    </div>
  );
}

function DayRow({ day, busy, isFirst, isLast, onDragStart, onDragEnd, onMove, onEdit, onDelete }: {
  day: ItineraryDay;
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (offset: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}) {
  const iconButton = 'inline-flex size-11 items-center justify-center rounded-control border border-border bg-card text-ink hover:bg-canvas disabled:opacity-40';
  const contentCount = day.activities.length + day.budgets.length;
  return (
    <div className="flex flex-wrap items-start gap-3">
      <span
        draggable={!busy}
        onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', day.dayId); onDragStart(); }}
        onDragEnd={onDragEnd}
        className="hidden cursor-grab items-center self-center text-muted sm:inline-flex"
        aria-hidden="true"
        title="Drag to reorder"
      >
        <GripVertical size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 font-heading font-bold text-ink">Day {day.dayNumber} · {formatDayDate(day.date)}</p>
        <p className="m-0 text-sm text-muted">{day.city}</p>
        {day.notes && <p className="m-0 mt-2 whitespace-pre-line text-sm">{day.notes}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={iconButton} disabled={busy || isFirst} onClick={() => onMove(-1)} aria-label={`Move day ${day.dayNumber} earlier`}><ArrowUp size={18} aria-hidden="true" /></button>
        <button type="button" className={iconButton} disabled={busy || isLast} onClick={() => onMove(1)} aria-label={`Move day ${day.dayNumber} later`}><ArrowDown size={18} aria-hidden="true" /></button>
        <Button variant="secondary" disabled={busy} onClick={onEdit} aria-label={`Edit day ${day.dayNumber}`}>Edit</Button>
        <ConfirmDialog
          triggerLabel={`Delete day ${day.dayNumber}`}
          title={`Delete day ${day.dayNumber}?`}
          description={
            <>
              <p className="m-0">Day {day.dayNumber} in {day.city} will be removed{contentCount > 0 ? ' together with its activities, images and budget entries' : ''}. Transport costs and linked bookings on this day are also removed.</p>
              <p className="m-0 mt-2">Later days move back one day and budget totals are recalculated. This cannot be undone.</p>
            </>
          }
          confirmLabel="Delete day"
          pendingLabel="Deleting…"
          disabled={busy}
          onConfirm={onDelete}
        />
      </div>
    </div>
  );
}

function DayForm({ idPrefix, cities, initial, dayCount, submitLabel, busy, onSubmit, onCancel }: {
  idPrefix: string;
  cities: City[];
  initial?: ItineraryDay;
  /** Present when adding: offers an insert position. */
  dayCount?: number;
  submitLabel: string;
  busy: boolean;
  onSubmit: (input: DayInput & { position?: number }) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const initialKey = initial ? cityKey({ name: initial.city, countryCode: initial.countryCode }) : '';
  // A stored city outside the current catalog filter stays selectable so editing notes still works.
  const options = initial && !cities.some(city => cityKey(city) === initialKey)
    ? [{ cityId: initialKey, name: initial.city, countryCode: initial.countryCode ?? '' }, ...cities]
    : cities;
  const [city, setCity] = useState(initialKey);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [position, setPosition] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = parseCityKey(city);
    if (!parsed) { setError('Choose a city.'); return; }
    setError('');
    const input: DayInput & { position?: number } = { ...parsed, notes: notes.trim() || undefined };
    if (position) input.position = Number(position);
    await onSubmit(input);
  }

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <FormField id={`${idPrefix}-city`} label="City" error={error}>
          <Select value={city} onChange={event => { setCity(event.target.value); setError(''); }} required>
            <option value="">Choose a city</option>
            {options.map(option => <option key={cityKey(option)} value={cityKey(option)}>{option.name}</option>)}
          </Select>
        </FormField>
        {dayCount !== undefined && dayCount > 0 && (
          <FormField id={`${idPrefix}-position`} label="Position" hint="Later days move forward one day.">
            <Select value={position} onChange={event => setPosition(event.target.value)}>
              <option value="">At the end (day {dayCount + 1})</option>
              {Array.from({ length: dayCount }, (_, index) => <option key={index} value={index + 1}>Before current day {index + 1}</option>)}
            </Select>
          </FormField>
        )}
      </div>
      <FormField id={`${idPrefix}-notes`} label="Notes (optional)">
        <textarea className={textareaClass} value={notes} maxLength={ITINERARY_LIMITS.dayNotes} onChange={event => setNotes(event.target.value)} />
      </FormField>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</Button>
        {onCancel && <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>}
      </div>
    </form>
  );
}
