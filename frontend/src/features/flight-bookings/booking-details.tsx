import Link from 'next/link';
import { BookingLifecycle, BookingStatusBadge, effectiveStatus } from '@/components/booking/booking-status';
import { BookingStepper } from '@/components/booking/booking-stepper';
import { Card } from '@/components/ui/card';
import { CancelBooking } from './cancel-booking';
import { FareSummary } from './fare-summary';
import { FlightTicket } from './flight-ticket';
import { calendarDate, count, daysUntil, maskDocument, passengerTypeName } from './format';
import { HoldPanel } from './hold-panel';
import { LinkButton } from './link-button';
import { RefundSummary } from './refund-status';
import { CopyReference, TicketActions } from './ticket-actions';
import type { Airport, FlightBooking } from './types';

const legLabels = ['Outbound', 'Return'];

function headline(booking: FlightBooking, airports: Record<string, Airport>): string {
  const [first] = booking.segments;
  const city = (code: string) => airports[code]?.city ?? code;
  const arrow = booking.segments.length > 1 ? ' and back' : '';
  return `${city(first.departureAirportCode)} to ${city(first.arrivalAirportCode)}${arrow}`;
}

/** A held booking: the earlier steps are finished and cannot be reopened without a new booking. */
export const payingSteps = [
  { id: 'flights', label: 'Flights' }, { id: 'passengers', label: 'Travelers' }, { id: 'review', label: 'Review' }, { id: 'payment', label: 'Payment' },
];

export function BookingDetails({ booking, airports, serverNow }: { booking: FlightBooking; airports: Record<string, Airport>; serverNow: string }) {
  const status = effectiveStatus(booking.status, booking.holdExpiresAt, serverNow);
  const [outbound] = booking.segments;
  const beforeDeparture = new Date(outbound.departureAt) > new Date(serverNow);
  const manageable = status === 'CONFIRMED' && beforeDeparture;
  const ticketable = (status === 'CONFIRMED' || status === 'COMPLETED') && !!booking.bookingReference;
  const id = booking.flightBookingId;

  return (
    <div className="stack">
      {status === 'PENDING' && <BookingStepper steps={payingSteps} current="payment" />}
      <header className="grid gap-4">
        <Link href="/bookings/flights" className="text-sm">Back to flight bookings</Link>
        <div className="flex flex-wrap items-center gap-3">
          <BookingStatusBadge status={status} />
          {manageable && <span className="text-sm text-muted">{daysUntil(outbound.departureAt, serverNow)}</span>}
        </div>
        <h1 className="m-0">{headline(booking, airports)}</h1>
        {booking.bookingReference && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="m-0 text-sm text-muted">
              Booking reference <strong className="ml-1 font-heading text-xl font-bold tracking-widest text-ink">{booking.bookingReference}</strong>
            </p>
            <CopyReference reference={booking.bookingReference} />
          </div>
        )}
        <BookingLifecycle status={status} />
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 gap-6">
          {booking.segments.map((segment, index) => (
            <FlightTicket key={segment.flightId} segment={segment} label={booking.segments.length > 1 ? legLabels[index] : undefined} airports={airports}>
              <SeatLine booking={booking} flightId={segment.flightId} />
            </FlightTicket>
          ))}
          <Travelers booking={booking} />
          {manageable && (
            <>
              <Card className="grid gap-4">
                <div>
                  <h2 className="m-0">Change flight</h2>
                  <p className="m-0 mt-2 text-sm text-muted">Move to another date or flight on the same route and in the same cabin. Your booking stays as it is until the change is complete.</p>
                </div>
                <div><LinkButton href={`/bookings/flights/${id}/change`} variant="secondary">Find another flight</LinkButton></div>
              </Card>
              <Card><CancelBooking bookingId={id} roundTrip={booking.segments.length > 1} /></Card>
            </>
          )}
        </div>

        <aside aria-label="Payment and documents" className={`grid gap-6 lg:sticky lg:top-6 ${status === 'PENDING' ? 'order-first lg:order-none' : ''}`}>
          <Card className="grid gap-5">
            <h2 className="m-0">{status === 'PENDING' ? 'Amount to pay' : 'Price'}</h2>
            <FareSummary {...booking} totalLabel={status === 'PENDING' ? 'To pay' : 'Total'} />
            {status === 'PENDING' && booking.holdExpiresAt && (
              <HoldPanel bookingId={id} expiresAt={booking.holdExpiresAt} serverNow={serverNow} totalAmount={booking.totalAmount} currency={booking.currency} />
            )}
            {status === 'EXPIRED' && (
              <div className="grid gap-3">
                <p className="m-0 text-sm text-muted">This booking was not paid in time, so its seats were released and nothing was charged.</p>
                <LinkButton href="/flights">Search flights again</LinkButton>
              </div>
            )}
          </Card>
          {status === 'CANCELLED' && (
            <Card className="grid gap-4">
              <h2 className="m-0">Refund</h2>
              <p className="m-0 text-sm text-body">
                {booking.cancelledBy === 'AIRLINE' ? 'The airline cancelled this flight.' : 'You cancelled this booking.'}
              </p>
              <RefundSummary refund={booking.refund} refundAmount={booking.refundAmount} currency={booking.currency} />
            </Card>
          )}
          {ticketable && (
            <Card className="grid gap-4">
              <h2 className="m-0">Your e-ticket</h2>
              <TicketActions bookingId={id} bookingReference={booking.bookingReference!} segments={booking.segments} createdAt={booking.createdAt} />
              <Link href={`/bookings/flights/${id}/ticket`}>View your ticket</Link>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function SeatLine({ booking, flightId }: { booking: FlightBooking; flightId: string }) {
  const seats = (booking.seatSelections ?? []).filter(seat => seat.flightId === flightId).map(seat => seat.seatNumber).sort((a, b) => a - b);
  if (!seats.length) return null;
  return (
    <div>
      <dt className="text-xs text-muted">{seats.length === 1 ? 'Seat' : 'Seats'}</dt>
      <dd className="m-0 font-semibold tabular-nums text-ink">{seats.join(', ')}</dd>
    </div>
  );
}

export function Travelers({ booking }: { booking: FlightBooking }) {
  return (
    <Card className="grid gap-4">
      <h2 className="m-0">{count(booking.passengers.length, 'traveler')}</h2>
      <ul className="m-0 grid list-none gap-4 p-0">
        {booking.passengers.map(passenger => {
          const seats = (booking.seatSelections ?? []).filter(seat => seat.passengerId === passenger.passengerId);
          return (
            <li key={passenger.passengerId} className="grid gap-1 border-t border-border pt-4 first:border-0 first:pt-0">
              <p className="m-0 flex flex-wrap items-baseline justify-between gap-x-4">
                <span className="font-semibold text-ink">{passenger.fullName}</span>
                <span className="text-sm text-muted">{passengerTypeName(passenger.type)}</span>
              </p>
              <p className="m-0 text-sm text-muted">
                Born {calendarDate(passenger.dateOfBirth)} · Document <span aria-label={`ending in ${passenger.documentNumber.slice(-4)}`}>{maskDocument(passenger.documentNumber)}</span>
                {passenger.extraBags > 0 && ` · ${count(passenger.extraBags, 'extra bag')}, ${passenger.extraBaggageWeightKg} kg`}
                {seats.map(seat => {
                  const segment = booking.segments.find(({ flightId }) => flightId === seat.flightId);
                  return segment ? ` · Seat ${seat.seatNumber} on ${segment.flightNumber}` : '';
                }).join('')}
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
