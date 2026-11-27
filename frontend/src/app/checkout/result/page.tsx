import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BookingStepper } from '@/components/booking/booking-stepper';
import { LoadFailed, TravelersOnly } from '@/features/payments/checkout-states';
import { ResultWatch } from '@/features/payments/result-watch';
import { checkoutLinks, checkoutPath, checkoutSteps, resultPath } from '@/features/payments/routes';
import { loadBookingState, loadPayment, settle } from '@/features/payments/server';
import { isCheckoutType, isObjectId, type Payment } from '@/features/payments/types';

// Rendering: dynamic SSR, never cached. The query string only says WHICH payment to check; the status
// shown always comes from GET /api/payments/:id, first here on the server, then from the client watch.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Payment status', robots: { index: false } };

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

function paidFor(payment: Payment): string | undefined {
  return payment.flightBookingId ?? payment.hotelBookingId ?? payment.flightBookingChangeId;
}

export default async function CheckoutResultPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  // Stripe adds payment_intent, payment_intent_client_secret and redirect_status after a redirect; they are ignored.
  const type = one(search.type);
  const bookingId = one(search.bookingId);
  const paymentId = one(search.paymentId);
  if (!isCheckoutType(type) || !isObjectId(bookingId) || !isObjectId(paymentId)) notFound();

  const here = resultPath(type, bookingId, paymentId);
  const loaded = settle(await loadPayment(paymentId), here);
  if (loaded.kind === 'forbidden') return <TravelersOnly />;
  if (loaded.kind === 'error') return <LoadFailed message={loaded.message} retryHref={here} />;
  const payment = loaded.data;
  // A link that pairs a payment with another booking is not trusted for the "continue" link either.
  if (payment.bookingType !== type || paidFor(payment)?.toLowerCase() !== bookingId.toLowerCase()) notFound();

  // The booking's own status decides success (see outcome.ts). A change also names its booking, for the return link.
  const booking = await loadBookingState(type, bookingId);
  const state = booking.kind === 'ok' ? booking.data.state : null;
  const links = checkoutLinks(type, bookingId, booking.kind === 'ok' ? booking.data.flightBookingId : undefined);
  const doneLabel = type === 'flight' ? 'View your ticket' : type === 'hotel' ? 'View your booking' : 'Back to your change';

  return (
    <section className="stack max-w-3xl">
      <BookingStepper steps={checkoutSteps} current="confirmation" label="Checkout progress" />
      <ResultWatch
        type={type} bookingId={bookingId} initialPayment={payment} initialBooking={state} serverNow={new Date().toISOString()}
        links={links} retryHref={checkoutPath(type, bookingId)} here={here} doneLabel={doneLabel}
      />
    </section>
  );
}
