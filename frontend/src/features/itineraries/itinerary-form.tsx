'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/ui/loading-state';
import { DateOnlyInput } from '@/features/hotels/date-only-input';
import { isValidDateOnly } from '@/features/hotels/date-only';
import { useDestinations } from '@/features/hotels/hotel-search/use-destinations';
import { ApiError } from '@/lib/api/client';
import type { ItineraryDetailsInput } from './api';
import { ITINERARY_LIMITS, type Itinerary, type ItineraryVisibility } from './types';

type Errors = Partial<Record<'title' | 'description' | 'countries' | 'startDate', string>>;

export interface ItineraryFormValues {
  title: string;
  description: string;
  countries: string[];
  startDate: string;
  visibility: ItineraryVisibility;
}

function validate(values: ItineraryFormValues): Errors {
  const errors: Errors = {};
  const title = values.title.trim();
  if (!title) errors.title = 'Enter a title.';
  else if (title.length > ITINERARY_LIMITS.title) errors.title = `Title must be at most ${ITINERARY_LIMITS.title} characters.`;
  if (values.description.trim().length > ITINERARY_LIMITS.description) errors.description = `Description must be at most ${ITINERARY_LIMITS.description} characters.`;
  if (values.countries.length === 0) errors.countries = 'Choose at least one country.';
  if (!values.startDate) errors.startDate = 'Choose a start date.';
  else if (!isValidDateOnly(values.startDate)) errors.startDate = 'Enter a real calendar date.';
  return errors;
}

/** Maps the backend's `errors` object (field -> messages) onto this form's fields. */
function serverFieldErrors(error: ApiError): Errors {
  const out: Errors = {};
  for (const key of ['title', 'description', 'countries', 'startDate'] as const) {
    const messages = error.fields[key];
    if (messages?.length) out[key] = messages[0];
  }
  return out;
}

/**
 * ITN-01 create/edit form for the itinerary details. Visibility is only chosen here on
 * create (private by default); afterwards it has its own control (ITN-20).
 * `lockedCountries` are countries already used by days: the backend rejects removing them.
 */
export function ItineraryForm({ mode, initial, lockedCountries = [], submitLabel, onSubmit, onCancel }: {
  mode: 'create' | 'edit';
  initial: ItineraryFormValues;
  lockedCountries?: string[];
  submitLabel: string;
  onSubmit: (input: ItineraryDetailsInput) => Promise<Itinerary>;
  onCancel?: () => void;
}) {
  const { countries, loading, error: catalogError } = useDestinations();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);

  function set<K extends keyof ItineraryFormValues>(key: K, value: ItineraryFormValues[K]) {
    setValues(current => ({ ...current, [key]: value }));
    setErrors(current => ({ ...current, [key]: undefined }));
  }

  function toggleCountry(code: string, checked: boolean) {
    set('countries', checked ? [...values.countries, code] : values.countries.filter(item => item !== code));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const found = validate(values);
    setErrors(found);
    setFormError('');
    if (Object.values(found).some(Boolean)) return;
    setPending(true);
    try {
      const input: ItineraryDetailsInput = {
        title: values.title.trim(),
        countries: values.countries,
        startDate: values.startDate,
      };
      const description = values.description.trim();
      // On edit an empty string clears the description; on create it is simply omitted.
      if (description || mode === 'edit') input.description = description;
      if (mode === 'create') input.visibility = values.visibility;
      await onSubmit(input);
    } catch (cause) {
      if (cause instanceof ApiError) {
        const fields = serverFieldErrors(cause);
        setErrors(fields);
        setFormError(Object.keys(fields).length ? 'Please correct the highlighted fields.' : cause.message);
      } else {
        setFormError('Please try again.');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-6" onSubmit={submit} noValidate aria-busy={pending}>
      {formError && <ErrorAlert message={formError} />}
      <FormField id="itinerary-title" label="Title" error={errors.title} hint={`Required, up to ${ITINERARY_LIMITS.title} characters.`}>
        <Input value={values.title} maxLength={ITINERARY_LIMITS.title} onChange={event => set('title', event.target.value)} autoComplete="off" required />
      </FormField>
      <FormField id="itinerary-description" label="Description (optional)" error={errors.description}>
        <textarea
          className="min-h-24 w-full rounded-control border border-border bg-card px-3 py-2.5 text-base text-body aria-invalid:border-danger"
          value={values.description}
          maxLength={ITINERARY_LIMITS.description}
          onChange={event => set('description', event.target.value)}
        />
      </FormField>
      <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0" aria-describedby={errors.countries ? 'itinerary-countries-error' : 'itinerary-countries-hint'}>
        <legend className="mb-2 p-0 text-sm font-semibold text-ink">Countries</legend>
        <p id="itinerary-countries-hint" className="m-0 text-sm text-muted">Choose every country you will visit. Day cities must be in one of them.</p>
        {loading && <LoadingState label="Loading countries…" />}
        {catalogError && <ErrorAlert message={catalogError} />}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {countries.map(country => {
            const checked = values.countries.includes(country.code);
            const locked = checked && lockedCountries.includes(country.code);
            return (
              <label key={country.code} className="flex min-h-11 items-center gap-3 rounded-control border border-border bg-card px-3">
                <input type="checkbox" className="size-5 accent-primary" checked={checked} disabled={locked} onChange={event => toggleCountry(country.code, event.target.checked)} />
                <span>{country.name}{locked && <span className="sr-only"> (used by a day)</span>}</span>
              </label>
            );
          })}
        </div>
        {lockedCountries.length > 0 && <p className="m-0 text-xs text-muted">Countries used by a day cannot be removed until those days change city.</p>}
        {errors.countries && <p id="itinerary-countries-error" className="m-0 text-sm text-danger">{errors.countries}</p>}
      </fieldset>
      <FormField id="itinerary-start" label="Start date" error={errors.startDate} hint={mode === 'edit' ? 'Changing it moves every day date with it.' : 'Day dates are counted from this date.'}>
        <DateOnlyInput value={values.startDate} onChange={value => set('startDate', value)} required />
      </FormField>
      {mode === 'create' && (
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-sm font-semibold text-ink">Visibility</legend>
          {(['PRIVATE', 'PUBLIC'] as const).map(option => (
            <label key={option} className="flex items-start gap-3">
              <input type="radio" name="visibility" className="mt-1 size-5 accent-primary" checked={values.visibility === option} onChange={() => set('visibility', option)} />
              <span>
                <span className="font-semibold">{option === 'PRIVATE' ? 'Private' : 'Public'}</span>
                <span className="block text-sm text-muted">{option === 'PRIVATE' ? 'Only you can see it. Recommended while planning.' : 'Anyone can find it in public itineraries and view it read-only.'}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : submitLabel}</Button>
        {onCancel && <Button variant="secondary" onClick={onCancel} disabled={pending}>Cancel</Button>}
      </div>
    </form>
  );
}
