'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Plane, BedDouble } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/error-alert';
import { FormField } from '@/components/ui/form-field';
import { LoadingState } from '@/components/ui/loading-state';
import { Select } from '@/components/ui/select';
import { apiClient } from '@/lib/api/client';
import { formatMoneyMinorUnits } from '@/lib/format/money';
import type { Mutate } from './activity-editor';
import * as api from './api';
import { formatDateOnly, formatDayDate, money } from './format';
import type { Itinerary, ItineraryDay, LinkedBooking } from './types';

const MAX_LINKED = 20;
type Kind = 'FLIGHT' | 'HOTEL';
type Group = 'UPCOMING' | 'PAST';

/**
 * What the link picker needs from each booking reader (Ismail: GET /flight-bookings,
 * Osama: GET /hotel-bookings). Booking amounts are integer cents (PAY-04); the itinerary's own
 * linked-booking view later reports them in major units.
 */
interface Candidate {
  bookingId: string;
  type: Kind;
  status: string;
  label: string;
  reference?: string;
  amountMinor: number;
  currency: string;
  /** Hotel: nights [checkIn, checkOut). Flight: the first segment's local departure date. */
  startDate: string;
  endDate?: string;
}

interface FlightRow { flightBookingId: string; status: string; bookingReference?: string; totalAmount: number; currency: string; segments: { flightNumber: string; departureAirportCode: string; arrivalAirportCode: string; departureAt: string; departureTimeZone: string }[] }
interface HotelRow { hotelBookingId: string; status: string; bookingReference?: string; hotelName: string; totalPrice: number; currency: string; checkIn: string; checkOut: string }
interface RowPage<T> { items: T[]; page: number; pageSize: number; total: number; totalPages?: number }

function localDate(instant: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
  } catch {
    return instant.slice(0, 10);
  }
}

function toCandidates(kind: Kind, page: RowPage<FlightRow> | RowPage<HotelRow>): Candidate[] {
  if (kind === 'FLIGHT') {
    return (page as RowPage<FlightRow>).items.map(row => ({
      bookingId: row.flightBookingId, type: 'FLIGHT', status: row.status, reference: row.bookingReference,
      label: row.segments.map(segment => `${segment.flightNumber} ${segment.departureAirportCode}→${segment.arrivalAirportCode}`).join(', '),
      amountMinor: row.totalAmount, currency: row.currency,
      startDate: row.segments[0] ? localDate(row.segments[0].departureAt, row.segments[0].departureTimeZone) : '',
    }));
  }
  return (page as RowPage<HotelRow>).items.map(row => ({
    bookingId: row.hotelBookingId, type: 'HOTEL', status: row.status, reference: row.bookingReference, label: row.hotelName,
    amountMinor: row.totalPrice, currency: row.currency, startDate: row.checkIn, endDate: row.checkOut,
  }));
}

/** Mirrors the backend rule only to offer sensible days; the backend decides. */
function daysFor(candidate: Candidate, days: ItineraryDay[]): ItineraryDay[] {
  return days.filter(day => candidate.type === 'HOTEL'
    ? day.date >= candidate.startDate && day.date < (candidate.endDate ?? candidate.startDate)
    : day.date === candidate.startDate);
}

const statusTone = (status: string | null) => (status === 'CONFIRMED' || status === 'COMPLETED' ? 'success' : status ? 'warning' : 'danger');

/** ITN-27 (bonus): link your own booked flights/hotels to days so they feed the budget once. */
export function LinkedBookingsEditor({ itinerary, busy, mutate }: { itinerary: Itinerary; busy: boolean; mutate: Mutate }) {
  const links = itinerary.linkedBookings ?? [];
  const [adding, setAdding] = useState(false);
  const dayOf = (dayId: string) => itinerary.days.find(day => day.dayId === dayId);

  return (
    <div className="grid gap-3">
      {links.length === 0 && !adding && <p className="m-0 text-sm text-muted">No bookings linked yet. Linked confirmed bookings are added to the budget once, at their live price.</p>}
      <ul className="m-0 grid list-none gap-2 p-0">
        {links.map(link => <LinkedRow key={link.linkedBookingId} link={link} day={dayOf(link.dayId)} itineraryId={itinerary.itineraryId} busy={busy} mutate={mutate} />)}
      </ul>
      {adding
        ? <LinkForm itinerary={itinerary} busy={busy} onCancel={() => setAdding(false)} onLink={async input => { const ok = await mutate(() => api.linkBooking(itinerary.itineraryId, input), 'Booking linked. It now counts in the budget.'); if (ok) setAdding(false); }} />
        : links.length >= MAX_LINKED
          ? <p className="m-0 text-sm text-muted">The limit of {MAX_LINKED} linked bookings is reached.</p>
          : <div><Button variant="secondary" disabled={busy || itinerary.days.length === 0} onClick={() => setAdding(true)}>Link a booking</Button></div>}
    </div>
  );
}

function LinkedRow({ link, day, itineraryId, busy, mutate }: { link: LinkedBooking; day?: ItineraryDay; itineraryId: string; busy: boolean; mutate: Mutate }) {
  const Icon = link.type === 'FLIGHT' ? Plane : BedDouble;
  // Osama's /bookings/hotels/[id] is not on develop yet; hotel links use the bookings hub until it lands.
  const detailHref = link.type === 'FLIGHT' ? `/bookings/flights/${encodeURIComponent(link.bookingId)}` : '/bookings';
  return (
    <li className="grid gap-2 rounded-control border border-border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <p className="m-0 flex min-w-0 items-center gap-2 font-semibold text-ink [overflow-wrap:anywhere]"><Icon size={16} aria-hidden="true" />{link.label ?? (link.type === 'FLIGHT' ? 'Flight booking' : 'Hotel booking')}</p>
          <p className="m-0 text-sm text-muted">
            {day ? `Day ${day.dayNumber} · ${formatDayDate(day.date)}` : 'Day removed'}
            {link.bookingReference && ` · Ref ${link.bookingReference}`}
            {link.amount !== undefined && link.currency && ` · ${money(link.amount, link.currency)}`}
            {link.startDate && ` · ${link.endDate ? `${formatDateOnly(link.startDate)} – ${formatDateOnly(link.endDate)}` : formatDateOnly(link.startDate)}`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge tone={statusTone(link.status)}>{link.status ? link.status.charAt(0) + link.status.slice(1).toLowerCase() : 'Booking no longer exists'}</Badge>
            <Badge tone={link.countsInBudget ? 'info' : 'neutral'}>{link.countsInBudget ? 'Counts in budget' : 'Not counted in budget'}</Badge>
            {link.matchesDay === false && <Badge tone="warning">Day no longer matches the booking dates</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {link.status && <Link href={detailHref} className="inline-flex min-h-11 items-center text-sm">View booking</Link>}
          <ConfirmDialog
            triggerLabel={`Unlink ${link.label ?? 'booking'}`}
            title="Unlink this booking?"
            description="It is removed from this itinerary and its budget. The booking itself is not changed or cancelled."
            confirmLabel="Unlink"
            pendingLabel="Unlinking…"
            disabled={busy}
            onConfirm={async () => {
              if (!(await mutate(() => api.unlinkBooking(itineraryId, link.linkedBookingId), 'Booking unlinked.'))) throw new Error('The booking could not be unlinked. See the message on the page.');
            }}
          />
        </div>
      </div>
      {link.matchesDay === false && <p className="m-0 text-sm text-muted">Reordering days or changing the start date moved this day off the booking. Unlink it and link it again to the right day.</p>}
    </li>
  );
}

function LinkForm({ itinerary, busy, onLink, onCancel }: {
  itinerary: Itinerary;
  busy: boolean;
  onLink: (input: { type: Kind; bookingId: string; dayId: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<Kind>('HOTEL');
  const [group, setGroup] = useState<Group>('UPCOMING');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Candidate[]; totalPages: number } | null>(null);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState<Candidate | null>(null);
  const [dayId, setDayId] = useState('');
  const linked = new Set((itinerary.linkedBookings ?? []).map(link => link.bookingId));

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    const path = kind === 'FLIGHT' ? '/flight-bookings' : '/hotel-bookings';
    apiClient<RowPage<FlightRow> | RowPage<HotelRow>>(`${path}?group=${group}&page=${page}`, { signal: controller.signal })
      .then(result => setData({ items: toCandidates(kind, result), totalPages: result.totalPages ?? Math.max(1, Math.ceil(result.total / (result.pageSize || 10))) }))
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Your bookings could not be loaded.'); });
    return () => controller.abort();
  }, [kind, group, page]);

  const eligibleDays = chosen ? daysFor(chosen, itinerary.days) : [];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!chosen || !dayId || busy) return;
    await onLink({ type: chosen.type, bookingId: chosen.bookingId, dayId });
  }

  function choose(candidate: Candidate) {
    setChosen(candidate);
    const days = daysFor(candidate, itinerary.days);
    setDayId(days[0]?.dayId ?? '');
  }

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-control border border-dashed border-border p-3" aria-label="Link a booking">
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <FormField id="link-kind" label="Booking type">
          <Select value={kind} onChange={event => { setKind(event.target.value as Kind); setPage(1); setChosen(null); }}>
            <option value="HOTEL">Hotel stays</option>
            <option value="FLIGHT">Flights</option>
          </Select>
        </FormField>
        <FormField id="link-group" label="Show">
          <Select value={group} onChange={event => { setGroup(event.target.value as Group); setPage(1); setChosen(null); }}>
            <option value="UPCOMING">Upcoming</option>
            <option value="PAST">Past</option>
          </Select>
        </FormField>
      </div>
      {error && <ErrorAlert title="Bookings unavailable" message={error} />}
      {!data && !error && <LoadingState label="Loading your bookings…" />}
      {data && (data.items.length === 0 ? (
        <EmptyState title={`No ${group === 'UPCOMING' ? 'upcoming' : 'past'} ${kind === 'HOTEL' ? 'hotel stays' : 'flights'}`} description="Only your own confirmed or completed bookings can be linked." />
      ) : (
        <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-sm font-semibold text-ink">Choose a booking</legend>
          {data.items.map(candidate => {
            const confirmed = candidate.status === 'CONFIRMED' || candidate.status === 'COMPLETED';
            const already = linked.has(candidate.bookingId);
            const reason = already ? 'Already linked' : !confirmed ? 'Only confirmed or completed bookings can be linked' : daysFor(candidate, itinerary.days).length === 0 ? 'No day of this trip falls on its dates' : '';
            return (
              <label key={candidate.bookingId} className={`flex min-h-11 items-start gap-3 rounded-control border border-border bg-card px-3 py-2 ${reason ? 'opacity-70' : ''}`}>
                <input type="radio" name="link-booking" className="mt-1 size-5 accent-primary" disabled={Boolean(reason)} checked={chosen?.bookingId === candidate.bookingId} onChange={() => choose(candidate)} />
                <span className="grid">
                  <span className="font-semibold">{candidate.label}{candidate.reference && <span className="font-normal text-muted"> · Ref {candidate.reference}</span>}</span>
                  <span className="text-sm text-muted">
                    {candidate.endDate ? `${formatDateOnly(candidate.startDate)} – ${formatDateOnly(candidate.endDate)}` : formatDateOnly(candidate.startDate)}
                    {' · '}{formatMoneyMinorUnits(candidate.amountMinor, candidate.currency)}
                    {reason && ` · ${reason}`}
                  </span>
                </span>
              </label>
            );
          })}
          {data.totalPages > 1 && (
            <div className="flex items-center justify-between gap-3">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <span className="text-sm text-muted">Page {page} of {data.totalPages}</span>
              <Button variant="secondary" disabled={page >= data.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          )}
        </fieldset>
      ))}
      {chosen && (
        <FormField id="link-day" label="Itinerary day" hint={chosen.type === 'HOTEL' ? 'Any night of the stay.' : "The flight's local departure date."}>
          <Select value={dayId} onChange={event => setDayId(event.target.value)}>
            {eligibleDays.map(day => <option key={day.dayId} value={day.dayId}>Day {day.dayNumber} · {formatDayDate(day.date)} · {day.city}</option>)}
          </Select>
        </FormField>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy || !chosen || !dayId}>{busy ? 'Linking…' : 'Link booking'}</Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
