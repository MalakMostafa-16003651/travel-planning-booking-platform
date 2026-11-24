'use client';

import { useState, type FormEvent } from 'react';
import { Clock, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { MediaUploader, type MediaItem } from '@/features/media/media-uploader';
import * as api from './api';
import { money, parseAmount } from './format';
import { MAX_ACTIVITY_IMAGES, type Activity, type Itinerary, type ItineraryDay } from './types';
import type { Attraction, Currency } from './use-catalog';

/** Runs one itinerary mutation, applies the returned itinerary and reports success. */
export type Mutate = (request: () => Promise<Itinerary>, success: string) => Promise<boolean>;

const textareaClass = 'min-h-20 w-full rounded-control border border-border bg-card px-3 py-2.5 text-base text-body aria-invalid:border-danger';
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

type Errors = Partial<Record<'title' | 'description' | 'location' | 'startTime' | 'endTime' | 'cost', string>>;

interface Draft {
  title: string; description: string; location: string; attractionId: string;
  startTime: string; endTime: string; cost: string; currency: string;
}

const draftOf = (activity: Activity | undefined, currency: string): Draft => ({
  title: activity?.title ?? '',
  description: activity?.description ?? '',
  location: activity?.location ?? '',
  attractionId: activity?.attractionId ?? '',
  startTime: activity?.startTime ?? '',
  endTime: activity?.endTime ?? '',
  cost: activity?.cost !== undefined ? String(activity.cost) : '',
  currency: activity?.currency ?? currency,
});

function validate(draft: Draft): Errors {
  const errors: Errors = {};
  const title = draft.title.trim();
  if (!title) errors.title = 'Enter a title.';
  else if (title.length > 120) errors.title = 'Title must be at most 120 characters.';
  if (draft.description.trim().length > 2000) errors.description = 'Description must be at most 2000 characters.';
  if (draft.location.trim().length > 200) errors.location = 'Location must be at most 200 characters.';
  if (draft.startTime && !TIME.test(draft.startTime)) errors.startTime = 'Use HH:mm.';
  if (draft.endTime && !TIME.test(draft.endTime)) errors.endTime = 'Use HH:mm.';
  if (!errors.startTime && !errors.endTime && draft.startTime && draft.endTime && draft.endTime < draft.startTime) errors.endTime = 'End time cannot be before the start time.';
  if (draft.cost.trim() && parseAmount(draft.cost) === null) errors.cost = 'Enter a non-negative amount with at most two decimals.';
  return errors;
}

/** ITN-10 activities and ITN-12 images for one day. */
export function ActivityEditor({ itineraryId, day, cityId, attractions, currencies, defaultCurrency, busy, mutate, apply }: {
  itineraryId: string;
  day: ItineraryDay;
  /** Catalog id of the day's city; attractions are limited to it (backend rule). */
  cityId?: string;
  attractions: Attraction[];
  currencies: Currency[];
  defaultCurrency: string;
  busy: boolean;
  mutate: Mutate;
  apply: (itinerary: Itinerary) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const cityAttractions = attractions.filter(attraction => attraction.cityId === cityId);
  const attractionName = (id?: string) => attractions.find(attraction => attraction.attractionId === id)?.name;

  return (
    <section className="grid gap-3" aria-label={`Activities for day ${day.dayNumber}`}>
      <h4 className="m-0 text-base">Activities</h4>
      {day.activities.length === 0 && !adding && <p className="m-0 text-sm text-muted">No activities yet.</p>}
      <ul className="m-0 grid list-none gap-3 p-0">
        {day.activities.map(activity => (
          <li key={activity.activityId} className="grid gap-3 rounded-control border border-border bg-card p-3">
            {editing === activity.activityId ? (
              <ActivityForm
                idPrefix={`activity-${activity.activityId}`}
                initial={draftOf(activity, defaultCurrency)}
                attractions={cityAttractions}
                currencies={currencies}
                busy={busy}
                submitLabel="Save activity"
                onCancel={() => setEditing(null)}
                onSubmit={async draft => {
                  const cost = draft.cost.trim() ? parseAmount(draft.cost) : null;
                  const input: Partial<api.ActivityInput> = {
                    title: draft.title.trim(),
                    description: draft.description.trim(),
                    location: draft.location.trim(),
                    attractionId: draft.attractionId || null,
                    // The DTO rejects "" for times; null clears a time that was set.
                    ...(draft.startTime ? { startTime: draft.startTime } : activity.startTime ? { startTime: null } : {}),
                    ...(draft.endTime ? { endTime: draft.endTime } : activity.endTime ? { endTime: null } : {}),
                    // cost: null removes the cost (and its currency) from the budget totals.
                    ...(cost === null ? (activity.cost !== undefined ? { cost: null, currency: null } : {}) : { cost, currency: draft.currency }),
                  };
                  const ok = await mutate(() => api.updateActivity(activity.activityId, input), 'Activity saved.');
                  if (ok) setEditing(null);
                  return ok;
                }}
              />
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid min-w-0 flex-1 gap-1">
                    <p className="m-0 font-semibold text-ink">{activity.title}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                      {activity.startTime && <span className="inline-flex items-center gap-1"><Clock size={14} aria-hidden="true" />{activity.startTime}{activity.endTime && `–${activity.endTime}`}</span>}
                      {(activity.location || activity.attractionId) && <span className="inline-flex items-center gap-1"><MapPin size={14} aria-hidden="true" />{[attractionName(activity.attractionId), activity.location].filter(Boolean).join(' · ')}</span>}
                      {activity.cost !== undefined && activity.currency && <span>{money(activity.cost, activity.currency)}</span>}
                    </div>
                    {activity.description && <p className="m-0 whitespace-pre-line text-sm">{activity.description}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" disabled={busy} onClick={() => setEditing(activity.activityId)} aria-label={`Edit activity ${activity.title}`}>Edit</Button>
                    <ConfirmDialog
                      triggerLabel={`Delete ${activity.title}`}
                      title="Delete this activity?"
                      description={`“${activity.title}”${activity.images.length ? ' and its images' : ''} will be removed and budget totals recalculated.`}
                      confirmLabel="Delete activity"
                      pendingLabel="Deleting…"
                      disabled={busy}
                      onConfirm={async () => {
                        if (!(await mutate(() => api.deleteActivity(activity.activityId), 'Activity deleted.'))) throw new Error('The activity could not be deleted. See the message on the page.');
                      }}
                    />
                  </div>
                </div>
                <MediaUploader
                  label={`Photos for ${activity.title}`}
                  value={activity.images.map(image => ({ id: image.imageId, url: image.url }))}
                  maxCount={MAX_ACTIVITY_IMAGES}
                  helpText="JPG or PNG, up to 5 MB each."
                  disabled={busy}
                  onUpload={async (file, onProgress): Promise<MediaItem> => {
                    const updated = await api.uploadActivityImage(activity.activityId, file, onProgress);
                    apply(updated);
                    const saved = updated.days.flatMap(item => item.activities).find(item => item.activityId === activity.activityId);
                    const image = saved?.images.at(-1);
                    return image ? { id: image.imageId, url: image.url } : { id: '', url: '' };
                  }}
                  onRemove={async item => apply(await api.deleteActivityImage(activity.activityId, item.id))}
                />
              </>
            )}
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="rounded-control border border-dashed border-border p-3">
          <ActivityForm
            idPrefix={`new-activity-${day.dayId}`}
            initial={draftOf(undefined, defaultCurrency)}
            attractions={cityAttractions}
            currencies={currencies}
            busy={busy}
            submitLabel="Add activity"
            onCancel={() => setAdding(false)}
            onSubmit={async draft => {
              const cost = draft.cost.trim() ? parseAmount(draft.cost) : null;
              const input: api.ActivityInput = { title: draft.title.trim() };
              if (draft.description.trim()) input.description = draft.description.trim();
              if (draft.location.trim()) input.location = draft.location.trim();
              if (draft.attractionId) input.attractionId = draft.attractionId;
              if (draft.startTime) input.startTime = draft.startTime;
              if (draft.endTime) input.endTime = draft.endTime;
              if (cost !== null) Object.assign(input, { cost, currency: draft.currency });
              const ok = await mutate(() => api.addActivity(itineraryId, day.dayId, input), 'Activity added.');
              if (ok) setAdding(false);
              return ok;
            }}
          />
        </div>
      ) : (
        <div><Button variant="secondary" disabled={busy} onClick={() => setAdding(true)}>Add activity to day {day.dayNumber}</Button></div>
      )}
    </section>
  );
}

function ActivityForm({ idPrefix, initial, attractions, currencies, busy, submitLabel, onSubmit, onCancel }: {
  idPrefix: string;
  initial: Draft;
  attractions: Attraction[];
  currencies: Currency[];
  busy: boolean;
  submitLabel: string;
  onSubmit: (draft: Draft) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft(current => ({ ...current, [key]: value }));
    setErrors(current => ({ ...current, [key]: undefined }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const found = validate(draft);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    await onSubmit(draft);
  }

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <FormField id={`${idPrefix}-title`} label="Activity title" error={errors.title}>
        <Input value={draft.title} maxLength={120} onChange={event => set('title', event.target.value)} />
      </FormField>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <FormField id={`${idPrefix}-start`} label="Start time (optional)" error={errors.startTime}>
          <Input type="time" value={draft.startTime} onChange={event => set('startTime', event.target.value)} />
        </FormField>
        <FormField id={`${idPrefix}-end`} label="End time (optional)" error={errors.endTime}>
          <Input type="time" value={draft.endTime} onChange={event => set('endTime', event.target.value)} />
        </FormField>
        <FormField id={`${idPrefix}-attraction`} label="Attraction (optional)" hint={attractions.length ? 'From the official list for this city.' : 'No listed attractions in this city.'}>
          <Select value={draft.attractionId} disabled={!attractions.length && !draft.attractionId} onChange={event => set('attractionId', event.target.value)}>
            <option value="">None</option>
            {attractions.map(attraction => <option key={attraction.attractionId} value={attraction.attractionId}>{attraction.name}</option>)}
          </Select>
        </FormField>
        <FormField id={`${idPrefix}-location`} label="Location (optional)" error={errors.location}>
          <Input value={draft.location} maxLength={200} onChange={event => set('location', event.target.value)} />
        </FormField>
        <FormField id={`${idPrefix}-cost`} label="Cost (optional)" error={errors.cost} hint="Leave empty for no cost. Counted under Activities.">
          <Input inputMode="decimal" value={draft.cost} onChange={event => set('cost', event.target.value)} />
        </FormField>
        <FormField id={`${idPrefix}-currency`} label="Cost currency">
          <Select value={draft.currency} onChange={event => set('currency', event.target.value)}>
            {currencies.map(currency => <option key={currency.code} value={currency.code}>{currency.code} · {currency.name}</option>)}
            {!currencies.some(currency => currency.code === draft.currency) && <option value={draft.currency}>{draft.currency}</option>}
          </Select>
        </FormField>
      </div>
      <FormField id={`${idPrefix}-description`} label="Description (optional)" error={errors.description}>
        <textarea className={textareaClass} value={draft.description} maxLength={2000} onChange={event => set('description', event.target.value)} />
      </FormField>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
