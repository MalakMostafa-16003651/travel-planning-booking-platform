import type { Metadata } from 'next';
import Link from 'next/link';
import { BookingStatusBadge, effectiveStatus } from '@/components/booking/booking-status';
import { BookingStepper } from '@/components/booking/booking-stepper';
import { HoldTimer } from '@/components/booking/hold-timer';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Travelers, payingSteps } from '@/features/flight-bookings/booking-details';
import { ConfirmationWatch } from '@/features/flight-bookings/confirmation-watch';
import { FlightTicket } from '@/features/flight-bookings/flight-ticket';
import { money } from '@/features/flight-bookings/format';
import { LinkButton } from '@/features/flight-bookings/link-button';
import { LoadFailed, TravelerOnly } from '@/features/flight-bookings/page-states';
import { loadAirports, loadBooking, settle } from '@/features/flight-bookings/server';
import { CopyReference, TicketActions } from '@/features/flight-bookings/ticket-actions';

// Rendering: dynamic SSR. FLT-23 confirmation and e-ticket, shown only from the server's own status.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your ticket', robots: { index: false } };

const legLabels = ['Outbound', 'Return'];

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const here = `/bookings/flights/${encodeURIComponent(id)}/ticket`;
  const [result, airports] = await Promise.all([loadBooking(id), loadAirports()]);
  const loaded = settle(result, here);
  if (loaded.kind === 'forbidden') return <TravelerOnly />;
  if (loaded.kind === 'error') return <LoadFailed message={loaded.message} retryHref={here} />;

  const booking = loaded.data;
  const serverNow = new Date().toISOString();
  const status = effectiveStatus(booking.status, booking.holdExpiresAt, serverNow);

  if (status === 'PENDING') {
    return (
      <section className="stack" aria-labelledby="ticket-heading">
        <BookingStepper current="payment" steps={payingSteps} />
        <h1 id="ticket-heading" className="m-0">Almost there</h1>
        <p className="m-0 max-w-prose text-muted">Your ticket appears here as soon as your payment is verified. If you have not paid yet, go back to your booking.</p>
        <ConfirmationWatch />
        {booking.holdExpiresAt && <HoldTimer expiresAt={booking.holdExpiresAt} serverNow={serverNow} label="Your seats are held for" />}
        <div><LinkButton href={`/bookings/flights/${id}`} variant="secondary">Back to booking</LinkButton></div>
      </section>
    );
  }

  if ((status !== 'CONFIRMED' && status !== 'COMPLETED') || !booking.bookingReference) {
    return (
      <section className="stack" aria-labelledby="ticket-heading">
        <h1 id="ticket-heading" className="m-0">Your ticket</h1>
        <EmptyState
          title="There is no ticket for this booking"
          description={status === 'CANCELLED' ? 'This booking was cancelled, so its ticket is no longer valid.' : 'This booking was not paid in time.'}
          action={<LinkButton href={`/bookings/flights/${id}`} variant="secondary">View booking</LinkButton>}
        />
      </section>
    );
  }

  return (
    <section className="stack" aria-labelledby="ticket-heading">
      <header className="grid gap-4">
        <Link href={`/bookings/flights/${id}`} className="text-sm">View booking</Link>
        <div><BookingStatusBadge status={status} /></div>
        <h1 id="ticket-heading" className="m-0">{status === 'CONFIRMED' ? 'You’re booked.' : 'Your ticket'}</h1>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <p className="m-0 text-sm text-muted">
            Booking reference
            <strong className="block font-heading text-4xl font-bold leading-tight tracking-widest text-ink">{booking.bookingReference}</strong>
          </p>
          <CopyReference reference={booking.bookingReference} />
        </div>
      </header>
      {booking.segments.map((segment, index) => (
        <FlightTicket key={segment.flightId} segment={segment} label={booking.segments.length > 1 ? legLabels[index] : undefined} airports={airports} />
      ))}
      <Travelers booking={booking} />
      <Card className="grid gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="m-0">Documents</h2>
          <p className="m-0 text-sm text-muted">Total paid <strong className="font-heading text-lg text-ink">{money(booking.totalAmount, booking.currency)}</strong></p>
        </div>
        <TicketActions bookingId={booking.flightBookingId} bookingReference={booking.bookingReference} segments={booking.segments} createdAt={booking.createdAt} />
      </Card>
    </section>
  );
}
