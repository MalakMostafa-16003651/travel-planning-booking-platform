'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookingStepper } from '@/components/booking/booking-stepper';
import { HoldTimer } from '@/components/booking/hold-timer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/error-alert';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/ui/loading-state';
import { BookingEmailGate } from '@/features/auth/email-verification';
import { ApiError, apiClient } from '@/lib/api/client';
import { formatMoneyMajorUnits } from '@/lib/format/money';
import { FlightTicket } from './flight-ticket';
import { cabinName, count, duration, localClock, localDay, localIsoDate, money, tierLines, zoneName } from './format';
import { LinkButton } from './link-button';
import { RefundSummary } from './refund-status';
import { RequestError } from './request-error';
import type { Airport, BookingSegment, ChangePolicies, FlightBooking, FlightBookingChange, OfferedCabin, OfferedFlight, OfferedFlightPage, SegmentChoice } from './types';

const legLabels = ['Outbound', 'Return'];
const steps = [{ id: 'choose', label: 'Choose a flight' }, { id: 'review', label: 'Review the change' }, { id: 'done', label: 'Done' }];

/** No endpoint lists a booking's pending change, so its id is kept for this tab. It holds no personal data. */
const storageKey = (bookingId: string) => `flight-change:${bookingId}`;
function remember(bookingId: string, changeId: string) {
  try { window.sessionStorage.setItem(storageKey(bookingId), changeId); } catch { /* The id is in the URL as well. */ }
}
function recall(bookingId: string): string | null {
  try { return window.sessionStorage.getItem(storageKey(bookingId)); } catch { return null; }
}

export function changeHref(bookingId: string, changeId: string): string {
  return `/bookings/flights/${bookingId}/change?change=${changeId}`;
}

interface Candidate {
  flight: OfferedFlight;
  cabin: OfferedCabin;
}

/** Step 1 of FLT-27: same route and cabin, another flight or date. Search and prices come from the server. */
export function ChangeSearch({ booking, airports, today }: { booking: FlightBooking; airports: Record<string, Airport>; today: string }) {
  const router = useRouter();
  const [choices, setChoices] = useState<(Candidate | null)[]>(() => booking.segments.map(() => null));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const submitting = useRef(false);
  const id = booking.flightBookingId;
  const changed = choices.some(Boolean);

  useEffect(() => { setPendingId(recall(id)); }, [id]);

  async function holdChange() {
    if (submitting.current || !changed) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    const segments: SegmentChoice[] = booking.segments.map((segment, index) => {
      const choice = choices[index];
      return choice ? { flightId: choice.flight.flightId, cabinId: choice.cabin.cabinId } : { flightId: segment.flightId, cabinId: segment.cabinId };
    });
    try {
      const change = await apiClient<FlightBookingChange>(`/flight-bookings/${id}/changes`, { method: 'POST', body: JSON.stringify({ segments }) });
      remember(id, change.flightBookingChangeId);
      router.push(changeHref(id, change.flightBookingChangeId));
      return;
    } catch (cause) {
      setError(cause);
    }
    submitting.current = false;
    setBusy(false);
  }

  return (
    <div className="stack">
      <BookingStepper steps={steps} current="choose" label="Change progress" />
      <div>
        <Link href={`/bookings/flights/${id}`} className="text-sm">Back to booking</Link>
        <h1 className="m-0 mt-3">Change your flight</h1>
        <p className="m-0 mt-2 max-w-prose text-muted">
          Same route, same cabin, same travelers. We hold the new seats for 10 minutes and show the fare difference before anything changes.
        </p>
      </div>
      {pendingId && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-sand bg-sand/20 p-4">
          <p className="m-0 text-sm text-ink">You started a change for this booking in this tab.</p>
          <LinkButton href={changeHref(id, pendingId)} variant="secondary">Open that change</LinkButton>
        </div>
      )}
      {error != null && <RequestError error={error} title="The new flight could not be held" />}
      {booking.segments.map((segment, index) => (
        <LegPicker
          key={segment.flightId}
          booking={booking}
          segment={segment}
          label={booking.segments.length > 1 ? legLabels[index] : 'Your flight'}
          airports={airports}
          today={today}
          choice={choices[index]}
          disabled={busy}
          onChoose={choice => setChoices(current => current.map((existing, position) => position === index ? choice : existing))}
        />
      ))}
      <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-card p-4">
        <p className="m-0 text-sm text-muted">{changed ? 'Next: see the exact fare difference.' : 'Choose a different flight to continue.'}</p>
        <BookingEmailGate returnTo={`/bookings/flights/${id}/change`}>
          <Button disabled={!changed || busy} onClick={holdChange}>{busy ? 'Holding the new seats…' : 'Hold and see the difference'}</Button>
        </BookingEmailGate>
      </div>
    </div>
  );
}

function LegPicker({ booking, segment, label, airports, today, choice, disabled, onChoose }: {
  booking: FlightBooking;
  segment: BookingSegment;
  label: string;
  airports: Record<string, Airport>;
  today: string;
  choice: Candidate | null;
  disabled: boolean;
  onChoose: (choice: Candidate | null) => void;
}) {
  const fieldId = useId();
  const [date, setDate] = useState(() => localIsoDate(segment.departureAt, segment.departureTimeZone));
  const [results, setResults] = useState<{ date: string; candidates: Candidate[]; page: number; pages: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  async function search(page: number) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    const amount = (type: string) => String(booking.passengers.filter(passenger => passenger.type === type).length);
    const query = new URLSearchParams({
      departureAirportCode: segment.departureAirportCode,
      arrivalAirportCode: segment.arrivalAirportCode,
      departureDate: date,
      roundTrip: 'false',
      adults: amount('ADULT'), children: amount('CHILD'), infants: amount('INFANT'),
      cabinClass: segment.cabinClass,
      sortBy: 'departureTime',
      page: String(page),
    });
    try {
      const found = await apiClient<OfferedFlightPage>(`/flights/search?${query}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const candidates = found.items.flatMap(flight => {
        const cabin = flight.cabins.find(option => option.cabinClass === segment.cabinClass);
        // The flight already booked is not a change; keeping it is its own choice below.
        return cabin && flight.flightId !== segment.flightId ? [{ flight, cabin }] : [];
      });
      setResults(previous => ({
        date,
        candidates: page > 1 && previous ? [...previous.candidates, ...candidates] : candidates,
        page: found.page,
        pages: found.totalPages ?? Math.max(1, Math.ceil(found.total / found.pageSize)),
      }));
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!date) return;
    onChoose(null);
    void search(1);
  }

  const shown = choice?.flight;
  return (
    <section aria-label={label} className="grid gap-4">
      <FlightTicket segment={segment} label={`${label} · current`} airports={airports} />
      <form onSubmit={submit} className="grid items-end gap-4 sm:grid-cols-[240px_auto]">
        <FormField id={fieldId} label={`New date from ${airports[segment.departureAirportCode]?.city ?? segment.departureAirportCode}`}>
          <Input type="date" min={today} value={date} onChange={event => setDate(event.target.value)} required disabled={disabled} />
        </FormField>
        <div><Button type="submit" variant="secondary" disabled={loading || disabled || !date}>{loading ? 'Searching…' : 'Find flights'}</Button></div>
      </form>
      {error != null && <RequestError error={error} title="Flights could not be loaded" />}
      {loading && !results && <LoadingState label="Looking for flights…" />}
      {results && results.candidates.length === 0 && results.page >= results.pages && (
        <EmptyState title="No other flights that day" description={`Try another date. Only ${cabinName(segment.cabinClass)} flights on this route with ${count(booking.seatCount, 'free seat')} are shown.`} />
      )}
      {results && (
        <ul className="m-0 grid list-none gap-3 p-0">
          {results.candidates.map(candidate => {
            const { flight, cabin } = candidate;
            const selected = shown?.flightId === flight.flightId;
            return (
              <li key={flight.flightId} className={`flex flex-wrap items-center justify-between gap-4 rounded-card border bg-card p-4 ${selected ? 'border-primary' : 'border-border'}`}>
                <div className="min-w-0">
                  <p className="m-0 font-heading text-lg font-bold tabular-nums text-ink">
                    {localClock(flight.departureAtUtc, flight.departureAirport.timeZone)} to {localClock(flight.arrivalAtUtc, flight.arrivalAirport.timeZone)}
                  </p>
                  <p className="m-0 text-sm text-muted">
                    {localDay(flight.departureAtUtc, flight.departureAirport.timeZone)} · {zoneName(flight.departureAtUtc, flight.departureAirport.timeZone)} to {zoneName(flight.arrivalAtUtc, flight.arrivalAirport.timeZone)} · {duration(flight.departureAtUtc, flight.arrivalAtUtc)}
                  </p>
                  <p className="m-0 text-sm text-muted">{flight.airlineName} · {flight.flightNumber} · {count(cabin.seatsRemaining, 'seat')} left</p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-muted"><strong className="text-ink">{money(cabin.price)}</strong> per adult or child</span>
                  <Button variant={selected ? 'primary' : 'secondary'} aria-pressed={selected} disabled={disabled} onClick={() => onChoose(selected ? null : candidate)}>
                    {selected ? 'Chosen' : 'Choose'}<span className="sr-only"> {flight.flightNumber}</span>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {results && results.page < results.pages && (
        <div><Button variant="secondary" disabled={loading} onClick={() => void search(results.page + 1)}>{loading ? 'Loading…' : 'Show more flights'}</Button></div>
      )}
      {!choice && booking.segments.length > 1 && <p className="m-0 text-sm text-muted">Nothing chosen: this flight stays as it is.</p>}
    </section>
  );
}

/** Step 2: the server's quote. Equal and lower fares finish here; a higher fare is paid in Hicham's checkout. */
export function ChangeReview({ booking, change, policies, airports, serverNow }: {
  booking: FlightBooking;
  change: FlightBookingChange;
  policies: ChangePolicies | null;
  airports: Record<string, Airport>;
  serverNow: string;
}) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [acceptError, setAcceptError] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState(false);
  const working = useRef(false);
  const { flightBookingId: bookingId, flightBookingChangeId: changeId, currency } = change;
  const live = change.status === 'PENDING' && !ended && new Date(change.holdExpiresAt) > new Date(serverNow);
  const applied = change.status === 'CONFIRMED';

  async function confirm() {
    if (working.current) return;
    if (!accepted) {
      setAcceptError('Accept the new flight’s policies to continue.');
      return;
    }
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      await apiClient(`/bookings/flight-change/${changeId}/accept-policies`, { method: 'POST', body: JSON.stringify({ accepted: true }) });
      await apiClient<FlightBookingChange>(`/flight-booking-changes/${changeId}/confirm`, { method: 'POST' });
    } catch (cause) {
      setError(cause);
    } finally {
      working.current = false;
      setBusy(false);
      router.refresh(); // Show what the server actually did, whether or not its answer arrived.
    }
  }

  async function cancelChange() {
    try {
      await apiClient<FlightBookingChange>(`/flight-booking-changes/${changeId}/cancel`, { method: 'POST' });
    } catch (cause) {
      // It may have just finished or run out; the refreshed page says which.
      if (!(cause instanceof ApiError && cause.status === 409)) throw cause;
    }
    router.refresh();
  }

  return (
    <div className="stack">
      <BookingStepper steps={steps} current={applied ? 'done' : 'review'} label="Change progress" />
      <div>
        <Link href={`/bookings/flights/${bookingId}`} className="text-sm">Back to booking</Link>
        <h1 className="m-0 mt-3">{applied ? 'Your flight is changed' : live ? 'Review the change' : 'This change has ended'}</h1>
        {applied && <p role="status" className="m-0 mt-2 text-muted">Your booking reference stays {booking.bookingReference}. Download your e-ticket again: the old one is out of date.</p>}
        {!applied && !live && <p role="status" className="m-0 mt-2 text-muted">The new seats were released. Your original booking is unchanged and still confirmed.</p>}
      </div>

      {live && (
        <HoldTimer
          expiresAt={change.holdExpiresAt}
          serverNow={serverNow}
          label="New seats are held for"
          expiredLabel="The hold on the new seats has ended"
          onExpire={() => { setEnded(true); router.refresh(); }}
        />
      )}
      {error != null && <RequestError error={error} title="The change was not completed" />}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 gap-6">
          <h2 className="m-0">{applied ? 'Your new trip' : 'New trip'}</h2>
          {change.segments.map((segment, index) => {
            const kept = !applied && booking.segments[index]?.flightId === segment.flightId;
            const label = [change.segments.length > 1 ? legLabels[index] : '', kept ? 'unchanged' : ''].filter(Boolean).join(' · ');
            return <FlightTicket key={segment.flightId} segment={segment} label={label || undefined} airports={airports} />;
          })}
          {live && policies && <ChangePolicyCard policies={policies} currency={currency} />}
          {live && (
            <Card className="grid gap-4">
              <div>
                <h2 className="m-0">Changed your mind?</h2>
                <p className="m-0 mt-2 text-sm text-muted">Release the new seats and keep your current flight. Nothing about your booking changes.</p>
              </div>
              <div>
                <ConfirmDialog
                  triggerLabel="Release new seats"
                  title="Keep your current flight?"
                  description="The new seats are released and your original booking stays exactly as it is."
                  confirmLabel="Yes, release them"
                  pendingLabel="Releasing…"
                  cancelLabel="Go back"
                  onConfirm={cancelChange}
                />
              </div>
            </Card>
          )}
          {live && (booking.seatSelections?.length ?? 0) > 0 && (
            <p className="m-0 text-sm text-muted">Seats chosen on a flight you replace are cleared. You can choose seats again afterwards.</p>
          )}
        </div>

        <aside aria-label="Fare difference" className="lg:sticky lg:top-6">
          <Card className="grid gap-5">
            <h2 className="m-0">Fare difference</h2>
            <dl className="m-0 grid gap-3 text-sm">
              <div className="flex justify-between gap-4"><dt>Paid before</dt><dd className="m-0 tabular-nums text-ink">{money(change.previousAmount, currency)}</dd></div>
              <div className="flex justify-between gap-4"><dt>New total</dt><dd className="m-0 tabular-nums text-ink">{money(change.totalAmount, currency)}</dd></div>
              <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3">
                <dt className="font-semibold text-ink">{change.amountToPay > 0 ? 'To pay' : change.refundAmount > 0 ? 'To be refunded' : 'Nothing to pay'}</dt>
                <dd className="m-0 font-heading text-2xl font-bold tabular-nums text-ink">{money(change.amountToPay || change.refundAmount, currency)}</dd>
              </div>
            </dl>
            {applied && change.refundAmount > 0 && <RefundSummary refund={change.refund} refundAmount={change.refundAmount} currency={currency} />}
            {applied && (
              <div className="grid gap-3">
                <LinkButton href={`/bookings/flights/${bookingId}/ticket`}>View your new ticket</LinkButton>
                <LinkButton href={`/bookings/flights/${bookingId}`} variant="secondary">View booking</LinkButton>
              </div>
            )}
            {!applied && !live && <LinkButton href={`/bookings/flights/${bookingId}/change`}>Choose again</LinkButton>}
            {live && change.amountToPay > 0 && (
              <div className="grid gap-3">
                <BookingEmailGate returnTo={changeHref(bookingId, changeId)}>
                  <LinkButton href={`/checkout/flight-change/${changeId}`} className="w-full">Pay the difference</LinkButton>
                </BookingEmailGate>
                <p className="m-0 text-sm text-muted">Your current flight stays confirmed until the payment is verified.</p>
              </div>
            )}
            {live && change.amountToPay === 0 && (
              <BookingEmailGate returnTo={changeHref(bookingId, changeId)}>
                <div className="grid gap-4">
                  {!policies && <ErrorAlert title="Policies could not be loaded" message="Reload this page to see the new flight’s policies before you confirm." />}
                  <div className="grid gap-2">
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-body">
                      <input
                        type="checkbox"
                        className="mt-1 size-5 shrink-0 accent-primary"
                        checked={accepted}
                        disabled={busy || !policies}
                        aria-invalid={Boolean(acceptError)}
                        aria-describedby={acceptError ? 'accept-error' : undefined}
                        onChange={event => { setAccepted(event.target.checked); setAcceptError(''); }}
                      />
                      I accept the new flight’s cancellation and baggage policies.
                    </label>
                    {acceptError && <p id="accept-error" className="m-0 text-sm text-danger">{acceptError}</p>}
                  </div>
                  <Button className="w-full" disabled={busy || !policies} onClick={confirm}>{busy ? 'Changing your flight…' : 'Confirm change'}</Button>
                </div>
              </BookingEmailGate>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function ChangePolicyCard({ policies, currency }: { policies: ChangePolicies; currency: string }) {
  const { cancellation, baggage } = policies.policies;
  return (
    <Card className="grid gap-4">
      <h2 className="m-0">New flight’s policies</h2>
      <div className="grid gap-1 text-sm">
        <p className="m-0 font-semibold text-ink">If you cancel</p>
        {cancellation.tiers.length
          ? <ul className="m-0 grid list-disc gap-1 pl-5 text-muted">{tierLines(cancellation.tiers).map(line => <li key={line}>{line}</li>)}</ul>
          : <p className="m-0 text-muted">This airline gives no refund for cancellations.</p>}
      </div>
      <div className="grid gap-1 text-sm">
        <p className="m-0 font-semibold text-ink">Extra baggage</p>
        {baggage.map((rule, index) => (
          <p key={`${rule.airlineId}-${index}`} className="m-0 text-muted">
            {baggage.length > 1 && `${legLabels[index]}: `}
            {/* This endpoint reports major units, unlike every booking amount on this page. */}
            {rule.maxExtraBagsPerPassenger > 0 ? `${formatMoneyMajorUnits(rule.pricePerExtraBag, currency)} each, up to ${rule.maxExtraBagsPerPassenger} per traveler` : 'Not available'}
          </p>
        ))}
      </div>
    </Card>
  );
}
