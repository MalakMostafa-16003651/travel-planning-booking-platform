'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert } from '@/components/ui/error-alert';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError, apiClient } from '@/lib/api/client';
import type { AuthenticatedUser } from '@/types/auth';

export interface UserProfile extends AuthenticatedUser {
  phoneNumber?: string;
  preferredCurrency?: string;
}

interface Currency {
  code: string;
  name: string;
}

type Draft = { name: string; phoneNumber: string; preferredCurrency: string };
type Field = keyof Draft;
type FieldErrors = Partial<Record<Field, string[]>>;

function profileDraft(profile: UserProfile): Draft {
  return {
    name: profile.name,
    phoneNumber: profile.phoneNumber ?? '',
    preferredCurrency: profile.preferredCurrency ?? '',
  };
}

function profileChanges(draft: Draft, profile: UserProfile): Partial<Draft> {
  const name = draft.name.trim();
  const phoneNumber = draft.phoneNumber.trim();
  const preferredCurrency = draft.preferredCurrency;
  const changes: Partial<Draft> = {};
  if (name !== profile.name) changes.name = name;
  if (phoneNumber !== (profile.phoneNumber ?? '')) changes.phoneNumber = phoneNumber;
  if (preferredCurrency !== (profile.preferredCurrency ?? '')) changes.preferredCurrency = preferredCurrency;
  return changes;
}

function validateChanges(changes: Partial<Draft>, currencies: Currency[]): FieldErrors {
  const errors: FieldErrors = {};
  if (changes.name === '') errors.name = ['Enter your name.'];
  else if (changes.name !== undefined && [...changes.name].length > 120) errors.name = ['Use at most 120 characters.'];
  if (changes.phoneNumber !== undefined && !/^\+[1-9]\d{7,14}$/.test(changes.phoneNumber)) {
    errors.phoneNumber = ['Enter an international number with + and 8 to 15 digits, or restore your saved number.'];
  }
  if (changes.preferredCurrency !== undefined && !currencies.some(({ code }) => code === changes.preferredCurrency)) {
    errors.preferredCurrency = ['Choose a supported currency.'];
  }
  return errors;
}

export function ProfileEditor({ profile, onSaved, onSaving }: {
  profile: UserProfile;
  onSaved: (updated: UserProfile) => void;
  onSaving: (saving: boolean) => void;
}) {
  const [draft, setDraft] = useState(() => profileDraft(profile));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<FieldErrors>({});
  const [currencies, setCurrencies] = useState<Currency[] | null>(null);
  const [currencyError, setCurrencyError] = useState('');
  const [currencyAttempt, setCurrencyAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function loadCurrencies() {
      try {
        const catalog = await apiClient<Currency[]>('/currencies', { signal: controller.signal });
        if (!controller.signal.aborted) setCurrencies(catalog);
      } catch (error) {
        if (!controller.signal.aborted) {
          setCurrencyError(error instanceof Error ? error.message : 'Currency choices could not be loaded.');
        }
      }
    }
    void loadCurrencies();
    return () => controller.abort();
  }, [currencyAttempt]);

  const changes = profileChanges(draft, profile);
  const dirty = Object.keys(changes).length > 0;
  const catalog = currencies ?? [];
  const savedCurrency = profile.preferredCurrency;
  const hasSavedCurrency = savedCurrency && catalog.some(({ code }) => code === savedCurrency);

  function updateField(field: Field, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setFields((current) => ({ ...current, [field]: undefined }));
    setSaved(false);
  }

  function discard() {
    setDraft(profileDraft(profile));
    setFields({});
    setError('');
    setSaved(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !dirty) return;

    setError('');
    setSaved(false);
    const invalid = validateChanges(changes, catalog);
    setFields(invalid);
    if (Object.keys(invalid).length) {
      setError('Check the highlighted fields and try again.');
      return;
    }

    setSaving(true);
    onSaving(true);
    try {
      const updated = await apiClient<UserProfile>('/users/me', {
        method: 'PATCH',
        headers: { 'X-Expected-User-Id': profile.userId },
        body: JSON.stringify(changes),
      });
      if (updated.userId !== profile.userId) throw new Error('Your session changed. Reload your profile and try again.');
      setDraft(profileDraft(updated));
      onSaved(updated);
      setSaved(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Your changes could not be saved.');
      if (error instanceof ApiError) setFields(error.fields);
    } finally {
      setSaving(false);
      onSaving(false);
    }
  }

  return (
    <Card aria-labelledby="profile-details-heading">
      <h2 id="profile-details-heading">Personal details</h2>
      <form method="post" className="mt-5 grid gap-5" noValidate onSubmit={submit} aria-busy={saving} aria-labelledby="profile-details-heading">
        {error && <ErrorAlert message={error} />}
        {saved && <p className="rounded-control bg-success/10 px-4 py-2 text-sm font-semibold text-ink" role="status">Profile saved.</p>}
        <fieldset className="grid min-w-0 gap-5 sm:grid-cols-2" disabled={saving}>
          <FormField id="profile-name" label="Name" error={fields.name?.[0]}>
            <Input name="name" autoComplete="name" value={draft.name} onChange={(event) => updateField('name', event.target.value)} required />
          </FormField>
          <FormField
            id="profile-phone"
            label="Phone number"
            hint="Optional. Use international format, such as +201012345678."
            error={fields.phoneNumber?.[0]}
          >
            <Input name="phoneNumber" type="tel" autoComplete="tel" value={draft.phoneNumber} onChange={(event) => updateField('phoneNumber', event.target.value)} />
          </FormField>
          <div className="grid gap-2">
            <FormField
              id="profile-currency"
              label="Preferred currency"
              hint="Optional. Travel bookings and payments remain in USD."
              error={fields.preferredCurrency?.[0]}
            >
              <Select
                name="preferredCurrency"
                value={draft.preferredCurrency}
                disabled={catalog.length === 0}
                onChange={(event) => updateField('preferredCurrency', event.target.value)}
              >
                {!savedCurrency && <option value="">Not set</option>}
                {savedCurrency && !hasSavedCurrency && <option value={savedCurrency}>{savedCurrency} (saved)</option>}
                {catalog.map(({ code, name }) => <option key={code} value={code}>{code} — {name}</option>)}
              </Select>
            </FormField>
            {currencyError && (
              <div className="grid gap-2">
                <ErrorAlert title="Currency choices unavailable" message={currencyError} />
                <Button className="justify-self-start" variant="secondary" onClick={() => {
                  setCurrencyError('');
                  setCurrencyAttempt((current) => current + 1);
                }}>
                  Retry currencies
                </Button>
              </div>
            )}
            {currencies?.length === 0 && <p className="text-sm text-muted">The currency catalog has no entries.</p>}
            {!currencies && !currencyError && <p className="text-sm text-muted" role="status">Loading currency choices…</p>}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
          {dirty && <Button variant="secondary" disabled={saving} onClick={discard}>Discard changes</Button>}
        </div>
      </form>
    </Card>
  );
}
