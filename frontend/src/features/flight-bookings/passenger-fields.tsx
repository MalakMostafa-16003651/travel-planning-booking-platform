'use client';

import { Baby, User, UserRound } from 'lucide-react';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { count, money, passengerTypeName } from './format';
import { typeHint, type BaggageRules, type FieldErrors, type PassengerDraft } from './passenger-rules';

const icons = { ADULT: User, CHILD: UserRound, INFANT: Baby };

export function fieldId(index: number, field: keyof PassengerDraft): string {
  return `passengers.${index}.${field}`;
}

export function PassengerFields({ index, draft, position, errors, baggage, today, onChange }: {
  index: number;
  draft: PassengerDraft;
  /** "Adult 2": the number within its own type. */
  position: number;
  errors: FieldErrors;
  baggage: BaggageRules;
  today: string;
  onChange: (field: keyof PassengerDraft, value: string) => void;
}) {
  const Icon = icons[draft.type];
  const bags = Number(draft.extraBags || '0');
  const id = (field: keyof PassengerDraft) => fieldId(index, field);
  const error = (field: keyof PassengerDraft) => errors[id(field)];

  return (
    <fieldset className="m-0 min-w-0 rounded-card border border-border bg-card p-5 sm:p-6">
      <legend className="sr-only">{passengerTypeName(draft.type)} {position}</legend>
      <div className="mb-5 flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Icon size={20} aria-hidden="true" /></span>
        <div>
          <p className="m-0 font-heading font-bold text-ink">{passengerTypeName(draft.type)} {position}</p>
          <p className="m-0 text-sm text-muted">{typeHint(draft.type)}</p>
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormField id={id('fullName')} label="Full name" hint="As it appears on the travel document." error={error('fullName')}>
            <Input autoComplete="off" maxLength={100} value={draft.fullName} onChange={event => onChange('fullName', event.target.value)} required />
          </FormField>
        </div>
        <FormField id={id('dateOfBirth')} label="Date of birth" error={error('dateOfBirth')}>
          <Input type="date" min="1900-01-01" max={today} value={draft.dateOfBirth} onChange={event => onChange('dateOfBirth', event.target.value)} required />
        </FormField>
        <FormField id={id('documentNumber')} label="Passport or ID number" error={error('documentNumber')}>
          <Input autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={20} value={draft.documentNumber} onChange={event => onChange('documentNumber', event.target.value)} required />
        </FormField>
        {baggage.maxExtraBags > 0 && (
          <>
            <FormField
              id={id('extraBags')}
              label="Extra bags"
              hint={`Optional, up to ${baggage.maxExtraBags}. ${money(baggage.pricePerBag)} per bag for the whole trip.`}
              error={error('extraBags')}
            >
              <Input type="number" inputMode="numeric" min={0} max={baggage.maxExtraBags} step={1} value={draft.extraBags} onChange={event => onChange('extraBags', event.target.value)} />
            </FormField>
            {bags > 0 && (
              <FormField
                id={id('extraBaggageWeightKg')}
                label="Total weight of extra bags (kg)"
                hint={`Up to ${bags * baggage.maxWeightPerBagKg} kg for ${count(bags, 'bag')}.`}
                error={error('extraBaggageWeightKg')}
              >
                <Input type="number" inputMode="decimal" min={0} step="any" value={draft.extraBaggageWeightKg} onChange={event => onChange('extraBaggageWeightKg', event.target.value)} />
              </FormField>
            )}
          </>
        )}
      </div>
    </fieldset>
  );
}
