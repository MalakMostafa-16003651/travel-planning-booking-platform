import { EmptyState } from '@/components/ui/empty-state';
import { LinkButton } from '@/features/flight-bookings/link-button';

// Also what a traveler sees for someone else's booking (ACC-11): its existence is never confirmed.
export default function BookingNotFound() {
  return (
    <section className="stack" aria-labelledby="booking-not-found">
      <h1 id="booking-not-found" className="m-0">Booking not found</h1>
      <EmptyState
        title="We could not find this booking in your account"
        description="Check the link, or open it from your bookings."
        action={<LinkButton href="/bookings/flights">Your flight bookings</LinkButton>}
      />
    </section>
  );
}
