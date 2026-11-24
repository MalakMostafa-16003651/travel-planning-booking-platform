'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { criteriaToParams, cabinLabel } from '@/lib/flights/format';
import { CABIN_CLASSES, type CabinClass, type SearchCriteria } from '@/lib/flights/types';
import { useAirports } from './use-airports';

export type { SearchCriteria } from '@/lib/flights/types';

export interface FlightSearchProps {
  /** "home" is the compact version for the landing page; "full" is used on /flights. */
  variant?: 'home' | 'full';
  initialCriteria?: Partial<SearchCriteria>;
}

type Errors = Partial<Record<'departureAirportCode' | 'arrivalAirportCode' | 'departureDate' | 'returnDate' | 'passengers', string>>;

export function FlightSearch({ variant = 'full', initialCriteria }: FlightSearchProps) {
  const router = useRouter();
  const { airports, loading, error: airportError } = useAirports();
  const [from, setFrom] = useState(initialCriteria?.departureAirportCode ?? '');
  const [to, setTo] = useState(initialCriteria?.arrivalAirportCode ?? '');
  const [roundTrip, setRoundTrip] = useState(initialCriteria?.roundTrip ?? false);
  const [departureDate, setDepartureDate] = useState(initialCriteria?.departureDate ?? '');
  const [returnDate, setReturnDate] = useState(initialCriteria?.returnDate ?? '');
  const [adults, setAdults] = useState(initialCriteria?.adults ?? 1);
  const [children, setChildren] = useState(initialCriteria?.children ?? 0);
  const [infants, setInfants] = useState(initialCriteria?.infants ?? 0);
  const [cabin, setCabin] = useState<CabinClass | ''>(initialCriteria?.cabinClass ?? '');
  const [errors, setErrors] = useState<Errors>({});

  function validate(): Errors {
    const e: Errors = {};
    if (!from) e.departureAirportCode = 'Choose where you are flying from.';
    if (!to) e.arrivalAirportCode = 'Choose where you are flying to.';
    else if (to === from) e.arrivalAirportCode = 'Departure and arrival must be different airports.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(departureDate)) e.departureDate = 'Choose a departure date.';
    if (roundTrip) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) e.returnDate = 'Choose a return date.';
      else if (returnDate < departureDate) e.returnDate = 'Return date cannot be before departure.';
    }
    if (adults < 1) e.passengers = 'At least one adult is required.';
    else if (infants > adults) e.passengers = 'There cannot be more infants than adults.';
    else if (adults + children + infants > 50) e.passengers = 'At most 50 passengers per search.';
    return e;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;
    const params = criteriaToParams({
      departureAirportCode: from, arrivalAirportCode: to, roundTrip, departureDate,
      returnDate: roundTrip ? returnDate : undefined, adults, children, infants, cabinClass: cabin || undefined,
    });
    router.push(`/flights?${params}`);
  }

  const airportOptions = airports.map(a => (
    <option key={a.code} value={a.code}>{a.city} ({a.code}) – {a.name}</option>
  ));
  const count = (value: number, set: (n: number) => void, min: number) => (
    <Input type="number" inputMode="numeric" min={min} max={50} value={value}
      onChange={e => set(Math.max(min, Math.min(50, Math.trunc(Number(e.target.value)) || min)))} />
  );

  return (
    <form onSubmit={submit} noValidate aria-label="Search flights" className={variant === 'home' ? 'grid gap-4 rounded-card border border-border bg-card p-4 md:p-6' : 'grid gap-4'}>
      {airportError && <ErrorAlert message={airportError} title="Airports unavailable" />}
      <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0">
        <legend className="sr-only">Trip type</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink">
          <input type="radio" name="trip" checked={!roundTrip} onChange={() => setRoundTrip(false)} /> One way
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink">
          <input type="radio" name="trip" checked={roundTrip} onChange={() => setRoundTrip(true)} /> Round trip
        </label>
      </fieldset>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField id="fs-from" label="From" error={errors.departureAirportCode}>
          <Select value={from} disabled={loading} onChange={e => setFrom(e.target.value)}>
            <option value="">{loading ? 'Loading airports…' : 'Select airport'}</option>
            {airportOptions}
          </Select>
        </FormField>
        <FormField id="fs-to" label="To" error={errors.arrivalAirportCode}>
          <Select value={to} disabled={loading} onChange={e => setTo(e.target.value)}>
            <option value="">{loading ? 'Loading airports…' : 'Select airport'}</option>
            {airportOptions}
          </Select>
        </FormField>
        <FormField id="fs-depart" label="Departure date" hint="Local date at the departure airport." error={errors.departureDate}>
          <Input type="date" value={departureDate} onChange={e => setDepartureDate(e.target.value)} />
        </FormField>
        {roundTrip && (
          <FormField id="fs-return" label="Return date" error={errors.returnDate}>
            <Input type="date" min={departureDate || undefined} value={returnDate} onChange={e => setReturnDate(e.target.value)} />
          </FormField>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField id="fs-adults" label="Adults (12+)">{count(adults, setAdults, 1)}</FormField>
        <FormField id="fs-children" label="Children (2–11)">{count(children, setChildren, 0)}</FormField>
        <FormField id="fs-infants" label="Infants (under 2)">{count(infants, setInfants, 0)}</FormField>
        <FormField id="fs-cabin" label="Cabin">
          <Select value={cabin} onChange={e => setCabin(e.target.value as CabinClass | '')}>
            <option value="">Any cabin</option>
            {CABIN_CLASSES.map(c => <option key={c} value={c}>{cabinLabel(c)}</option>)}
          </Select>
        </FormField>
      </div>
      {errors.passengers && <p role="alert" className="m-0 text-sm text-danger">{errors.passengers}</p>}
      <div><Button type="submit"><Search size={18} aria-hidden="true" />Search flights</Button></div>
    </form>
  );
}
