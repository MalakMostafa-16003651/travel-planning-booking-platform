'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button, buttonClassName } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/error-alert';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/ui/loading-state';
import { Select } from '@/components/ui/select';
import { FlightCard } from '@/features/flights/flight-card';
import { useAirports } from '@/features/flights/use-airports';
import { DateOnlyInput } from '@/features/hotels/date-only-input';
import { ApiError } from '@/lib/api/client';
import { cabinLabel } from '@/lib/flights/format';
import { CABIN_CLASSES, type Flight, type FlightSelection, type Page } from '@/lib/flights/types';
import { searchTripFlights, type TripFlightQuery, type TripFlightSearch } from './api';
import { formatDateOnly } from './format';

type Results = Page<Flight> | { outbound: Page<Flight>; return: Page<Flight> };
type Pick = { flightId: string; cabinId: string };

function describe(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Flights could not be loaded. Please try again.';
  if (error.status === 503) return 'Flight search is not available right now.';
  return Object.values(error.fields).flat()[0] ?? error.message;
}

/** ITN-26 R2: a return leg must leave from where the outbound lands, after it lands, back to the origin. */
function pairs(outbound: Flight, inbound: Flight): boolean {
  return outbound.arrivalAirport.code === inbound.departureAirport.code
    && outbound.departureAirport.code === inbound.arrivalAirport.code
    && Date.parse(inbound.departureAtUtc) > Date.parse(outbound.arrivalAtUtc);
}

export function toQueryString(query: TripFlightQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value));
  return params.toString();
}

/**
 * ITN-26: flights from a chosen origin to any airport of the trip's first city, reusing
 * Gamila's FLT-11/12 search through the itinerary endpoint and her FlightCard. Dates default
 * to the trip's first and last day (server-derived); the selection continues into Ismail's
 * booking flow with the shared FlightSelection contract. Prices on cards are booking cents.
 */
export function TripFlightSearchPanel({ itineraryId, firstCity, defaults, initial }: {
  itineraryId: string;
  firstCity: string;
  defaults: { departureDate: string; returnDate?: string };
  initial: TripFlightQuery | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { airports, error: airportError } = useAirports();
  const [query, setQuery] = useState<TripFlightQuery | null>(initial);
  const [draft, setDraft] = useState({
    origin: initial?.departureAirportCode ?? '',
    roundTrip: initial?.roundTrip ?? true,
    departureDate: initial?.departureDate ?? defaults.departureDate,
    returnDate: initial?.returnDate ?? defaults.returnDate ?? defaults.departureDate,
    adults: String(initial?.adults ?? 1), children: String(initial?.children ?? 0), infants: String(initial?.infants ?? 0),
    cabinClass: initial?.cabinClass ?? '',
  });
  const [formError, setFormError] = useState('');
  const [result, setResult] = useState<TripFlightSearch<Results> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [outbound, setOutbound] = useState<Pick | null>(null);
  const [inbound, setInbound] = useState<Pick | null>(null);
  const destinationCodes = useMemo(() => new Set(airports.filter(airport => airport.city === firstCity).map(airport => airport.code)), [airports, firstCity]);

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setOutbound(null);
    setInbound(null);
    searchTripFlights<Results>(itineraryId, query, controller.signal)
      .then(setResult)
      .catch(cause => { if (!controller.signal.aborted) { setResult(null); setError(describe(cause)); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    router.replace(`${pathname}?${toQueryString(query)}`, { scroll: false });
    return () => controller.abort();
  }, [itineraryId, query, pathname, router]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const [adults, children, infants] = [draft.adults, draft.children, draft.infants].map(Number);
    const problem = !draft.origin ? 'Choose the airport you leave from.'
      : destinationCodes.has(draft.origin) ? `You are already in ${firstCity}: choose an airport in another city.`
      : ![adults, children, infants].every(Number.isInteger) || adults < 1 || children < 0 || infants < 0 ? 'Enter at least one adult and whole numbers of passengers.'
      : infants > adults ? 'Each infant must travel with an adult.'
      : !draft.departureDate ? 'Choose a departure date.'
      : draft.roundTrip && draft.returnDate < draft.departureDate ? 'The return date cannot be before departure.'
      : '';
    setFormError(problem);
    if (problem) return;
    setQuery({
      departureAirportCode: draft.origin, roundTrip: draft.roundTrip, departureDate: draft.departureDate,
      returnDate: draft.roundTrip ? draft.returnDate : undefined, adults, children, infants,
      cabinClass: draft.cabinClass || undefined, page: 1,
    });
  }

  const data = result?.results;
  const oneWay = data && 'items' in data ? data : null;
  const round = data && 'outbound' in data ? data : null;
  const outboundPage = oneWay ?? round?.outbound ?? null;
  const chosenOutbound = outboundPage?.items.find(flight => flight.flightId === outbound?.flightId);
  const returnChoices = round && chosenOutbound ? round.return.items.filter(flight => pairs(chosenOutbound, flight)) : [];
  const ready = Boolean(outbound && (!query?.roundTrip || inbound));
  const selection: FlightSelection | null = ready && query
    ? { segments: [outbound!, ...(query.roundTrip ? [inbound!] : [])], adults: query.adults, children: query.children, infants: query.infants }
    : null;
  const totalPages = Math.max(outboundPage?.totalPages ?? 0, round?.return.totalPages ?? 0);
  const origins = [...airports].filter(airport => !destinationCodes.has(airport.code)).sort((a, b) => a.city.localeCompare(b.city));

  return (
    <div className="stack">
      <form className="grid gap-4 rounded-card border border-border bg-card p-5" onSubmit={submit} noValidate>
        {airportError && <ErrorAlert title="Airports unavailable" message={airportError} />}
        <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0">
          <legend className="mb-2 p-0 text-sm font-semibold text-ink">Trip type</legend>
          {[true, false].map(value => (
            <label key={String(value)} className="flex min-h-11 items-center gap-2">
              <input type="radio" name="trip-type" className="size-5 accent-primary" checked={draft.roundTrip === value} onChange={() => setDraft({ ...draft, roundTrip: value })} />
              {value ? 'Round trip' : 'One way'}
            </label>
          ))}
        </fieldset>
        <div className="grid items-start gap-4 md:grid-cols-2 lg:grid-cols-4">
          <FormField id="trip-origin" label="From airport">
            <Select value={draft.origin} onChange={event => setDraft({ ...draft, origin: event.target.value })}>
              <option value="">Choose an airport</option>
              {origins.map(airport => <option key={airport.code} value={airport.code}>{airport.city} · {airport.name} ({airport.code})</option>)}
            </Select>
          </FormField>
          <FormField id="trip-departure" label="Departure date" hint="Local date at the departure airport. Defaults to day 1.">
            <DateOnlyInput value={draft.departureDate} onChange={departureDate => setDraft({ ...draft, departureDate })} />
          </FormField>
          {draft.roundTrip && (
            <FormField id="trip-return" label="Return date" hint="Defaults to the trip's last day.">
              <DateOnlyInput value={draft.returnDate} min={draft.departureDate} onChange={returnDate => setDraft({ ...draft, returnDate })} />
            </FormField>
          )}
          <FormField id="trip-cabin" label="Cabin">
            <Select value={draft.cabinClass} onChange={event => setDraft({ ...draft, cabinClass: event.target.value })}>
              <option value="">Any cabin</option>
              {CABIN_CLASSES.map(cabin => <option key={cabin} value={cabin}>{cabinLabel(cabin)}</option>)}
            </Select>
          </FormField>
          <FormField id="trip-adults" label="Adults (12+)"><Input type="number" min={1} inputMode="numeric" value={draft.adults} onChange={event => setDraft({ ...draft, adults: event.target.value })} /></FormField>
          <FormField id="trip-children" label="Children (2–11)"><Input type="number" min={0} inputMode="numeric" value={draft.children} onChange={event => setDraft({ ...draft, children: event.target.value })} /></FormField>
          <FormField id="trip-infants" label="Infants (under 2)"><Input type="number" min={0} inputMode="numeric" value={draft.infants} onChange={event => setDraft({ ...draft, infants: event.target.value })} /></FormField>
        </div>
        {formError && <p role="alert" className="m-0 text-sm text-danger">{formError}</p>}
        <div><Button type="submit" disabled={loading}>Search flights to {firstCity}</Button></div>
      </form>

      {result && (
        <p className="m-0" aria-live="polite">
          {result.criteria.departureAirportCode} → {firstCity} ({result.criteria.arrivalAirportCodes.join(', ')}) on {formatDateOnly(result.criteria.departureDate)}
          {result.criteria.returnDate && `, returning ${formatDateOnly(result.criteria.returnDate)}`}.
        </p>
      )}
      {loading && <LoadingState label="Searching flights…" />}
      {error && <ErrorAlert title="Flights unavailable" message={error} />}

      {!loading && outboundPage && (
        <section aria-labelledby="trip-outbound-heading" className="grid gap-4">
          <h2 id="trip-outbound-heading" className="m-0 text-xl">{query?.roundTrip ? '1. Choose your outbound flight' : 'Choose your flight'}</h2>
          {outboundPage.items.length === 0
            ? <EmptyState title="No flights found" description="Try another date, origin airport or cabin." />
            : outboundPage.items.map(flight => (
              <FlightCard key={flight.flightId} flight={flight} selectedCabinId={outbound?.flightId === flight.flightId ? outbound.cabinId : undefined}
                onSelectCabin={(chosen, cabin) => { setOutbound({ flightId: chosen.flightId, cabinId: cabin.cabinId }); setInbound(null); }} />
            ))}
        </section>
      )}
      {!loading && round && (
        <section aria-labelledby="trip-inbound-heading" className="grid gap-4">
          <h2 id="trip-inbound-heading" className="m-0 text-xl">2. Choose your return flight</h2>
          {!chosenOutbound ? <p className="m-0 text-muted">Choose an outbound flight first; only returns that match it are shown.</p>
            : returnChoices.length === 0 ? <EmptyState title="No matching return flights" description="Try another return date or outbound flight." />
            : returnChoices.map(flight => (
              <FlightCard key={flight.flightId} flight={flight} selectedCabinId={inbound?.flightId === flight.flightId ? inbound.cabinId : undefined}
                onSelectCabin={(chosen, cabin) => setInbound({ flightId: chosen.flightId, cabinId: cabin.cabinId })} />
            ))}
        </section>
      )}
      {!loading && query && totalPages > 1 && (
        <nav aria-label="Flight result pages" className="flex items-center justify-between gap-3">
          <Button variant="secondary" disabled={query.page <= 1} onClick={() => setQuery({ ...query, page: query.page - 1 })}>Previous</Button>
          <span className="text-sm text-muted">Page {query.page} of {totalPages}</span>
          <Button variant="secondary" disabled={query.page >= totalPages} onClick={() => setQuery({ ...query, page: query.page + 1 })}>Next</Button>
        </nav>
      )}
      {selection && (
        <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-primary bg-card p-4 shadow-lg">
          <p className="m-0 font-semibold text-ink">{query?.roundTrip ? 'Outbound and return selected.' : 'Flight selected.'}</p>
          <Link href={`/bookings/flights/new?selection=${encodeURIComponent(JSON.stringify(selection))}`} className={buttonClassName('primary')}>Continue to booking</Link>
        </div>
      )}
    </div>
  );
}
