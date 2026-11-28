'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { Mutate } from './activity-editor';
import * as api from './api';
import { categoryLabels, money, parseAmount } from './format';
import { BUDGET_CATEGORIES, type BudgetCategory, type BudgetEntry, type ItineraryDay } from './types';
import type { Currency } from './use-catalog';

interface Draft { category: BudgetCategory; amount: string; currency: string; description: string }

/** ITN-14: non-negative daily budget entries in a catalog currency. */
export function BudgetEditor({ itineraryId, day, currencies, defaultCurrency, busy, mutate }: {
  itineraryId: string;
  day: ItineraryDay;
  currencies: Currency[];
  defaultCurrency: string;
  busy: boolean;
  mutate: Mutate;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const toInput = (draft: Draft): api.BudgetInput => ({
    category: draft.category, amount: parseAmount(draft.amount)!, currency: draft.currency, description: draft.description.trim(),
  });

  return (
    <section className="grid gap-3" aria-label={`Budget for day ${day.dayNumber}`}>
      <h4 className="m-0 text-base">Budget entries</h4>
      {day.budgets.length === 0 && !adding && <p className="m-0 text-sm text-muted">No budget entries yet.</p>}
      <ul className="m-0 grid list-none gap-2 p-0">
        {day.budgets.map(entry => (
          <li key={entry.budgetId} className="rounded-control border border-border bg-card p-3">
            {editing === entry.budgetId ? (
              <BudgetForm
                idPrefix={`budget-${entry.budgetId}`}
                initial={draftOf(entry, defaultCurrency)}
                currencies={currencies}
                busy={busy}
                submitLabel="Save entry"
                onCancel={() => setEditing(null)}
                onSubmit={async draft => {
                  const ok = await mutate(() => api.updateBudget(entry.budgetId, toInput(draft)), 'Budget entry saved.');
                  if (ok) setEditing(null);
                }}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 font-semibold text-ink">{categoryLabels[entry.category]} · {money(entry.amount, entry.currency)}</p>
                  {entry.description && <p className="m-0 text-sm text-muted">{entry.description}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" disabled={busy} onClick={() => setEditing(entry.budgetId)} aria-label={`Edit ${categoryLabels[entry.category]} entry ${money(entry.amount, entry.currency)}`}>Edit</Button>
                  <ConfirmDialog
                    triggerLabel="Delete entry"
                    title="Delete this budget entry?"
                    description={`${categoryLabels[entry.category]}, ${money(entry.amount, entry.currency)}. Totals are recalculated.`}
                    confirmLabel="Delete entry"
                    pendingLabel="Deleting…"
                    disabled={busy}
                    onConfirm={async () => {
                      if (!(await mutate(() => api.deleteBudget(entry.budgetId), 'Budget entry deleted.'))) throw new Error('The entry could not be deleted. See the message on the page.');
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
          <BudgetForm
            idPrefix={`new-budget-${day.dayId}`}
            initial={draftOf(undefined, defaultCurrency)}
            currencies={currencies}
            busy={busy}
            submitLabel="Add entry"
            onCancel={() => setAdding(false)}
            onSubmit={async draft => {
              const input = toInput(draft);
              if (!input.description) delete input.description;
              const ok = await mutate(() => api.addBudget(itineraryId, day.dayId, input), 'Budget entry added.');
              if (ok) setAdding(false);
            }}
          />
        </div>
      ) : (
        <div><Button variant="secondary" disabled={busy} onClick={() => setAdding(true)}>Add budget entry to day {day.dayNumber}</Button></div>
      )}
    </section>
  );
}

const draftOf = (entry: BudgetEntry | undefined, currency: string): Draft => ({
  category: entry?.category ?? 'FOOD',
  amount: entry ? String(entry.amount) : '',
  currency: entry?.currency ?? currency,
  description: entry?.description ?? '',
});

export function CurrencySelect({ value, currencies, onChange, ...props }: { value: string; currencies: Currency[]; onChange: (code: string) => void; id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) {
  return (
    <Select value={value} onChange={event => onChange(event.target.value)} {...props}>
      {currencies.map(currency => <option key={currency.code} value={currency.code}>{currency.code} · {currency.name}</option>)}
      {!currencies.some(currency => currency.code === value) && <option value={value}>{value}</option>}
    </Select>
  );
}

function BudgetForm({ idPrefix, initial, currencies, busy, submitLabel, onSubmit, onCancel }: {
  idPrefix: string;
  initial: Draft;
  currencies: Currency[];
  busy: boolean;
  submitLabel: string;
  onSubmit: (draft: Draft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<{ amount?: string; description?: string }>({});

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const found = {
      amount: parseAmount(draft.amount) === null ? 'Enter a non-negative amount with at most two decimals.' : undefined,
      description: draft.description.trim().length > 500 ? 'Description must be at most 500 characters.' : undefined,
    };
    setErrors(found);
    if (found.amount || found.description) return;
    await onSubmit(draft);
  }

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <div className="grid items-start gap-4 sm:grid-cols-3">
        <FormField id={`${idPrefix}-category`} label="Category">
          <Select value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value as BudgetCategory })}>
            {BUDGET_CATEGORIES.map(category => <option key={category} value={category}>{categoryLabels[category]}</option>)}
          </Select>
        </FormField>
        <FormField id={`${idPrefix}-amount`} label="Amount" error={errors.amount}>
          <Input inputMode="decimal" value={draft.amount} onChange={event => { setDraft({ ...draft, amount: event.target.value }); setErrors({ ...errors, amount: undefined }); }} />
        </FormField>
        <FormField id={`${idPrefix}-currency`} label="Currency">
          <CurrencySelect value={draft.currency} currencies={currencies} onChange={currency => setDraft({ ...draft, currency })} />
        </FormField>
      </div>
      <FormField id={`${idPrefix}-description`} label="Description (optional)" error={errors.description}>
        <Input value={draft.description} maxLength={500} onChange={event => setDraft({ ...draft, description: event.target.value })} />
      </FormField>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
