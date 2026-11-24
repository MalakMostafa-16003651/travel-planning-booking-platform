import type { Metadata } from 'next';
import { EmptyState } from '@/components/ui/empty-state';
import { ChangeReview, ChangeSearch } from '@/features/flight-bookings/change-flow';
import { LinkButton } from '@/features/flight-bookings/link-button';
import { LoadFailed, TravelerOnly } from '@/features/flight-bookings/page-states';
import { loadAirports, loadBooking, loadChange, loadChangePolicies, settle } from '@/features/flight-bookings/server';

// Rendering: dynamic SSR shell around client search and confirmation (FLT-27).
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Change flight', robots: { index: false } };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ChangeFlightPage({ params, searchParams }: Props) {
  const { id } = await params;
  const raw = (await searchParams).change;
  const changeId = Array.isArray(raw) ? raw[0] : raw;
  const here = `/bookings/flights/${encodeURIComponent(id)}/change${changeId ? `?change=${encodeURIComponent(changeId)}` : ''}`;

  const [result, airports] = await Promise.all([loadBooking(id), loadAirports()]);
  const booking = settle(result, here);
  if (booking.kind === 'forbidden') return <TravelerOnly />;
  if (booking.kind === 'error') return <LoadFailed message={booking.message} retryHref={here} />;
  const now = new Date();

  if (changeId) {
    const change = settle(await loadChange(changeId), here);
    if (change.kind === 'forbidden') return <TravelerOnly />;
    if (change.kind === 'error') return <LoadFailed message={change.message} retryHref={here} />;
    // A change id from another of the traveler's bookings is ignored.
    if (change.data.flightBookingId === booking.data.flightBookingId) {
      const policies = change.data.status === 'PENDING' ? await loadChangePolicies(changeId) : null;
      return <ChangeReview booking={booking.data} change={change.data} policies={policies} airports={airports} serverNow={now.toISOString()} />;
    }
  }

  const changeable = booking.data.status === 'CONFIRMED' && booking.data.segments.every(segment => new Date(segment.departureAt) > now);
  if (!changeable) {
    return (
      <section className="stack" aria-labelledby="not-changeable">
        <h1 id="not-changeable" className="m-0">Change your flight</h1>
        <EmptyState
          title="This booking cannot be changed"
          description="Only confirmed bookings can be changed, and only before the first departure."
          action={<LinkButton href={`/bookings/flights/${id}`} variant="secondary">Back to booking</LinkButton>}
        />
      </section>
    );
  }
  return <ChangeSearch booking={booking.data} airports={airports} today={now.toISOString().slice(0, 10)} />;
}
