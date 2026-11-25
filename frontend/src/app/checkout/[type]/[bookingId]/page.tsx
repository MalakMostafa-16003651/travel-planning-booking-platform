import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { effectiveStatus } from '@/components/booking/booking-status';
import { Checkout } from '@/features/payments/checkout';
import { ActionLink, CheckoutNotice, LoadFailed, TravelersOnly } from '@/features/payments/checkout-states';
import { checkoutLinks, checkoutPath } from '@/features/payments/routes';
import { loadCheckout, settle } from '@/features/payments/server';
import { isCheckoutType, isObjectId } from '@/features/payments/types';

// Rendering: dynamic SSR, never cached. The amount, policies, status and hold belong to one signed-in
// traveler and change by the second, so every request reads them fresh with the traveler's cookies.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Checkout', robots: { index: false } };

export default async function CheckoutPage({ params }: { params: Promise<{ type: string; bookingId: string }> }) {
  const { type, bookingId } = await params;
  if (!isCheckoutType(type) || !isObjectId(bookingId)) notFound();

  const here = checkoutPath(type, bookingId);
  const loaded = settle(await loadCheckout(type, bookingId), here);
  if (loaded.kind === 'forbidden') return <TravelersOnly />;
  if (loaded.kind === 'error') return <LoadFailed message={loaded.message} retryHref={here} />;

  const { policies, summary } = loaded.data;
  const serverNow = new Date().toISOString();
  const links = checkoutLinks(type, bookingId, summary.flightBookingId);
  // A Pending hold past its time is already unusable, even before the server's sweep marks it Expired.
  const status = effectiveStatus(summary.status, summary.holdExpiresAt, serverNow);

  if (status === 'CONFIRMED' || status === 'COMPLETED') {
    return (
      <CheckoutNotice
        title="This booking is already paid"
        message="There is nothing left to pay here."
        action={<ActionLink href={links.done}>{type === 'flight' ? 'View your ticket' : 'View your booking'}</ActionLink>}
      />
    );
  }
  if (status === 'EXPIRED') {
    return (
      <CheckoutNotice
        title="Your hold has expired"
        message="The time to pay for this booking has ended. If you were charged, the full amount is refunded. Go back to make a new booking."
        action={<ActionLink href={links.back} variant="secondary">Back to booking</ActionLink>}
      />
    );
  }
  if (status === 'CANCELLED') {
    return (
      <CheckoutNotice
        title="This booking was cancelled"
        message="A cancelled booking cannot be paid."
        action={<ActionLink href={links.back} variant="secondary">Back to booking</ActionLink>}
      />
    );
  }
  // FLT-27: equal and lower fares are confirmed on the change page; the backend refuses to charge them (409).
  if (type === 'flight-change' && policies.amount <= 0) {
    return (
      <CheckoutNotice
        title="Nothing to pay for this change"
        message="Your new fare is the same or lower, so there is no payment. Confirm the change on the change page; any difference is refunded."
        action={<ActionLink href={links.back}>Back to your change</ActionLink>}
      />
    );
  }

  return <Checkout type={type} bookingId={bookingId} policies={policies} summary={summary} serverNow={serverNow} links={links} />;
}
