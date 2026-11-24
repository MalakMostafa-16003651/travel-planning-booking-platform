import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/error-alert';
import { LinkButton } from './link-button';

/** Flight bookings belong to travelers. Admins and moderators get the backend's 403. */
export function TravelerOnly() {
  return (
    <section className="stack" aria-labelledby="traveler-only">
      <h1 id="traveler-only" className="m-0">Access denied</h1>
      <p className="m-0">Only traveler accounts have bookings. Sign in with a traveler account to continue.</p>
      <div><LinkButton href="/" variant="secondary">Back to home</LinkButton></div>
    </section>
  );
}

export function LoadFailed({ message, retryHref }: { message: string; retryHref: string }) {
  return (
    <section className="stack">
      <ErrorAlert title="This page could not be loaded" message={message} />
      {/* A full load, because the failed server response must not come from the router cache. */}
      <div><a href={retryHref}>Try again</a></div>
    </section>
  );
}

export function SelectionMissing({ message }: { message: string }) {
  return (
    <section className="stack" aria-labelledby="book-flight">
      <h1 id="book-flight" className="m-0">Book a flight</h1>
      <EmptyState title="Choose your flight first" description={message} action={<LinkButton href="/flights">Search flights</LinkButton>} />
    </section>
  );
}
