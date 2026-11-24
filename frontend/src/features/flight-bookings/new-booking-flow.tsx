'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { BookingStepper } from '@/components/booking/booking-stepper';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert } from '@/components/ui/error-alert';
import { BookingEmailGate } from '@/features/auth/email-verification';
import { ApiError, apiClient } from '@/lib/api/client';
import { FareSummary } from './fare-summary';
import { FlightTicket, segmentFromOffer } from './flight-ticket';
import { count, money, passengerTypeName, tierLines } from './format';
import { LinkButton } from './link-button';
import { PassengerFields, fieldId } from './passenger-fields';
import { emptyPassengers, readServerErrors, toPassengerInput, validatePassengers, type BaggageRules, type FieldErrors, type PassengerDraft } from './passenger-rules';
import { RequestError } from './request-error';
import { selectionHref } from './selection';
import type { BookingRequest, BookingSummary, FlightBooking, FlightBookingPage, FlightSelection, OfferedCabin, OfferedFlight } from './types';

export interface SelectedOffer {
  flight: OfferedFlight;
  cabin: OfferedCabin;
}

const legLabels = ['Outbound', 'Return'];
const MAX_HOLD_PAGES = 5;

function bookingSteps() {
  return [
    { id: 'flights', label: 'Flights', href: '/flights' },
    { id: 'passengers', label: 'Travelers' },
    { id: 'review', label: 'Review' },
    { id: 'payment', label: 'Payment' },
  ];
}

function baggageRules(offers: SelectedOffer[]): BaggageRules {
  return {
    // Each airline sets its own limit, so the strictest one on the trip applies to every bag.
    maxExtraBags: Math.min(...offers.map(({ flight }) => flight.baggagePolicy?.maxExtraBagsPerPassenger ?? 0)),
    maxWeightPerBagKg: Math.min(...offers.map(({ cabin }) => cabin.baggageMaxWeightKg)),
    pricePerBag: offers.reduce((sum, { flight }) => sum + (flight.baggagePolicy?.pricePerExtraBag ?? 0), 0),
  };
}

/** A hold that reached the server even though its answer did not reach the browser. */
async function findHoldFor(request: BookingRequest): Promise<FlightBooking | undefined> {
  for (let page = 1; page <= MAX_HOLD_PAGES; page += 1) {
    // Upcoming only lists holds that are still live by the server's clock.
    const list = await apiClient<FlightBookingPage>(`/flight-bookings?group=UPCOMING&page=${page}`);
    const match = list.items.find(booking => booking.status === 'PENDING'
      && booking.segments.length === request.segments.length
      && booking.segments.every((segment, index) => segment.flightId === request.segments[index].flightId && segment.cabinId === request.segments[index].cabinId)
      && booking.passengers.length === request.passengers.length
      && booking.passengers.every((passenger, index) => passenger.documentNumber === request.passengers[index].documentNumber));
    if (match || page * list.pageSize >= list.total) return match;
  }
  return undefined;
}

export function NewBookingFlow({ selection, offers, today, liveHoldId }: {
  selection: FlightSelection;
  offers: SelectedOffer[];
  /** YYYY-MM-DD from the server, so the date picker does not depend on the device clock. */
  today: string;
  liveHoldId?: string;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<PassengerDraft[]>(() => emptyPassengers(selection));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [general, setGeneral] = useState<string[]>([]);
  const [failure, setFailure] = useState<unknown>(null);
  const [summary, setSummary] = useState<BookingSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [holding, setHolding] = useState(false);
  const submitting = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const leaving = useRef(false);

  const baggage = useMemo(() => baggageRules(offers), [offers]);
  const departureAt = offers[0].flight.departureAtUtc;
  const seatsNeeded = selection.adults + selection.children;
  const shortOfSeats = offers.filter(({ cabin }) => cabin.seatsRemaining < seatsNeeded);
  const step = summary ? 'review' : 'passengers';
  const here = selectionHref(selection);
  const dirty = drafts.some(draft => draft.fullName || draft.dateOfBirth || draft.documentNumber);

  // Travel documents stay in memory only, so warn before a refresh throws them away.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { if (!leaving.current) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    heading.current?.focus();
    window.scrollTo({ top: 0 });
  }, [step]);

  function request(): BookingRequest {
    return { segments: selection.segments, passengers: drafts.map(toPassengerInput) };
  }

  function update(index: number, field: keyof PassengerDraft, value: string) {
    setDrafts(current => current.map((draft, position) => position === index ? { ...draft, [field]: value } : draft));
    setErrors(current => {
      const { [fieldId(index, field)]: _cleared, ...rest } = current;
      return rest;
    });
  }

  function focusFirst(invalid: FieldErrors) {
    const first = Object.keys(invalid)[0];
    if (first) requestAnimationFrame(() => document.getElementById(first)?.focus());
  }

  function showServerError(error: unknown) {
    if (error instanceof ApiError && error.status === 400 && Object.keys(error.fields).length) {
      const read = readServerErrors(error.fields);
      setSummary(null);
      setErrors(read.fields);
      setGeneral(read.general);
      focusFirst(read.fields);
      return;
    }
    setFailure(error);
  }

  function clearErrors() {
    setErrors({});
    setGeneral([]);
    setFailure(null);
  }

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    clearErrors();
    const invalid = validatePassengers(drafts, departureAt, baggage);
    if (Object.keys(invalid).length) {
      setErrors(invalid);
      focusFirst(invalid);
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      setSummary(await apiClient<BookingSummary>('/flight-bookings', { method: 'POST', body: JSON.stringify(request()) }));
    } catch (error) {
      showServerError(error);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function openBooking(id: string) {
    leaving.current = true;
    router.replace(`/bookings/flights/${id}`);
  }

  async function hold() {
    if (submitting.current) return;
    submitting.current = true;
    setHolding(true);
    clearErrors();
    const body = request();
    try {
      const booking = await apiClient<FlightBooking>('/flight-bookings/hold', { method: 'POST', body: JSON.stringify(body) });
      openBooking(booking.flightBookingId);
      return; // Keep the button disabled while the booking page opens.
    } catch (error) {
      // No answer is not proof that nothing was held. Look before letting the traveler try again.
      if (error instanceof ApiError && (error.status === 0 || error.status >= 500)) {
        const found = await findHoldFor(body).catch(() => undefined);
        if (found) { openBooking(found.flightBookingId); return; }
      }
      showServerError(error);
      if (error instanceof ApiError && error.status === 409) router.refresh();
    }
    submitting.current = false;
    setHolding(false);
  }

  const seatConflict = failure instanceof ApiError && failure.status === 409;

  return (
    <div className="stack">
      <BookingStepper steps={bookingSteps()} current={step} />
      <h1 ref={heading} tabIndex={-1} className="m-0 outline-none">{summary ? 'Check your trip' : 'Who is travelling?'}</h1>

      {liveHoldId && !summary && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-sand bg-sand/20 p-4">
          <p className="m-0 text-sm text-ink">You already hold seats on {offers.length > 1 ? 'these flights' : 'this flight'}. Continue with that booking instead of holding more seats.</p>
          <LinkButton href={`/bookings/flights/${liveHoldId}`} variant="secondary">Continue that booking</LinkButton>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 gap-6">
          {failure != null && <RequestError error={failure} title={seatConflict ? 'This trip is no longer available as chosen' : undefined} />}
          {seatConflict && (
            <div className="flex flex-wrap gap-3">
              <LinkButton href="/flights" variant="secondary">Choose other flights</LinkButton>
            </div>
          )}
          {general.map(message => <ErrorAlert key={message} title="Check the traveler details" message={message} />)}

          {!summary ? (
            <form noValidate onSubmit={review} aria-busy={busy} className="grid gap-5">
              <fieldset disabled={busy} className="m-0 grid min-w-0 gap-5 border-0 p-0">
                {drafts.map((draft, index) => (
                  <PassengerFields
                    key={index}
                    index={index}
                    draft={draft}
                    position={drafts.slice(0, index + 1).filter(other => other.type === draft.type).length}
                    errors={errors}
                    baggage={baggage}
                    today={today}
                    onChange={(field, value) => update(index, field, value)}
                  />
                ))}
              </fieldset>
              {shortOfSeats.length > 0 && (
                <ErrorAlert
                  title="Not enough seats right now"
                  message={`${shortOfSeats.map(({ flight }) => flight.flightNumber).join(' and ')} no longer has ${count(seatsNeeded, 'seat')} in this cabin. Choose another flight or cabin.`}
                />
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <LinkButton href="/flights" variant="secondary">Back to flights</LinkButton>
                <Button type="submit" disabled={busy || shortOfSeats.length > 0}>{busy ? 'Pricing your trip…' : 'Review trip'}</Button>
              </div>
            </form>
          ) : (
            <section aria-labelledby="review-travelers" className="grid gap-5">
              {offers.map(({ flight, cabin }, index) => (
                <FlightTicket
                  key={flight.flightId}
                  segment={segmentFromOffer(flight, cabin)}
                  label={offers.length > 1 ? legLabels[index] : undefined}
                  airports={{ [flight.departureAirport.code]: flight.departureAirport, [flight.arrivalAirport.code]: flight.arrivalAirport }}
                  airlineName={flight.airlineName}
                />
              ))}
              <Card className="grid gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 id="review-travelers" className="m-0">Travelers and bags</h2>
                  <Button variant="secondary" disabled={holding} onClick={() => setSummary(null)}>Edit</Button>
                </div>
                <ul className="m-0 grid list-none gap-3 p-0">
                  {summary.passengers.map((passenger, index) => (
                    <li key={index} className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-border pt-3 text-sm first:border-0 first:pt-0">
                      <span className="font-semibold text-ink">{passenger.fullName}</span>
                      <span className="text-muted">
                        {passengerTypeName(passenger.type)}
                        {passenger.extraBags > 0 && ` · ${count(passenger.extraBags, 'extra bag')}, ${passenger.extraBaggageWeightKg} kg`}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
              <TripPolicies offers={offers} />
            </section>
          )}
        </div>

        <aside aria-label="Trip summary" className="lg:sticky lg:top-6">
          <Card className="grid gap-5">
            <h2 className="m-0">{summary ? 'Price' : 'Your trip'}</h2>
            {summary ? (
              <>
                <FareSummary {...summary} />
                <p className="m-0 text-sm text-muted">
                  We hold {count(summary.seatCount, 'seat')} for 10 minutes while you pay. Nothing is charged until you accept the airline’s policies and pay.
                </p>
                <BookingEmailGate returnTo={here}>
                  <Button disabled={holding} onClick={hold} className="w-full">{holding ? 'Holding your seats…' : 'Hold seats and continue'}</Button>
                </BookingEmailGate>
              </>
            ) : (
              <>
                <ul className="m-0 grid list-none gap-4 p-0">
                  {offers.map(({ flight, cabin }, index) => (
                    <li key={flight.flightId} className="grid gap-1 border-t border-border pt-4 text-sm first:border-0 first:pt-0">
                      {offers.length > 1 && <span className="text-xs font-semibold uppercase tracking-widest text-primary">{legLabels[index]}</span>}
                      <span className="font-heading text-lg font-bold text-ink">{flight.departureAirport.code} to {flight.arrivalAirport.code}</span>
                      <span className="text-muted">{flight.airlineName} · {flight.flightNumber}</span>
                      <span className="text-muted">{money(cabin.price)} per adult or child</span>
                    </li>
                  ))}
                </ul>
                <p className="m-0 border-t border-border pt-4 text-sm text-muted">
                  {[count(selection.adults, 'adult'), selection.children ? count(selection.children, 'child', 'children') : '', selection.infants ? count(selection.infants, 'infant') : ''].filter(Boolean).join(', ')}.
                  {' '}The total is calculated when you review the trip.
                </p>
              </>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function TripPolicies({ offers }: { offers: SelectedOffer[] }) {
  return (
    <Card className="grid gap-4">
      <h2 className="m-0">Baggage and cancellation</h2>
      {offers.map(({ flight, cabin }) => (
        <div key={flight.flightId} className="grid gap-1 text-sm">
          <p className="m-0 font-semibold text-ink">{flight.airlineName} · {flight.flightNumber}</p>
          <p className="m-0 text-muted">
            Free per traveler: {count(cabin.baggageAllowanceCount, 'bag')} up to {cabin.baggageMaxWeightKg} kg each.
            {flight.baggagePolicy && flight.baggagePolicy.maxExtraBagsPerPassenger > 0
              && ` Extra bags: ${money(flight.baggagePolicy.pricePerExtraBag)} each, up to ${flight.baggagePolicy.maxExtraBagsPerPassenger}.`}
          </p>
        </div>
      ))}
      <div className="grid gap-1 border-t border-border pt-4 text-sm">
        <p className="m-0 font-semibold text-ink">If you cancel{offers.length > 1 && ' (the whole trip follows the outbound airline)'}</p>
        {offers[0].flight.cancellationTiers?.length
          ? <ul className="m-0 grid list-disc gap-1 pl-5 text-muted">{tierLines(offers[0].flight.cancellationTiers).map(line => <li key={line}>{line}</li>)}</ul>
          : <p className="m-0 text-muted">This airline gives no refund for cancellations.</p>}
      </div>
    </Card>
  );
}
