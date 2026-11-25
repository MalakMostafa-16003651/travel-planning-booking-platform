'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClassName } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { LoadingState } from '@/components/ui/loading-state';
import { loginHref } from '@/config/routes';
import { ApiError, apiClient } from '@/lib/api/client';
import { formatPaymentAmount } from './money';
import { bookingReadPath, paymentOutcome, toBookingState, type BookingState, type Outcome } from './outcome';
import { PaymentRefundStatus } from './payment-refund-status';
import type { CheckoutLinks } from './routes';
import type { CheckoutType, Payment } from './types';

const EVERY_MS = 2000;
// About a minute, then the traveler decides. An open tab must not keep an idle session alive forever.
const MAX_CHECKS = 30;

export interface ResultWatchProps {
  type: CheckoutType;
  bookingId: string;
  /** The payment and booking as the server read them while rendering the page. */
  initialPayment: Payment;
  initialBooking: BookingState | null;
  serverNow: string;
  links: CheckoutLinks;
  /** Back to checkout, which retries a failed payment while the hold lasts. */
  retryHref: string;
  /** This page, for signing in again. */
  here: string;
  /** "View your ticket", "View your booking"... */
  doneLabel: string;
}

type Stop = { kind: 'signed-out' } | { kind: 'not-found' } | null;

const headlines: Record<Outcome, string> = {
  confirmed: 'Payment confirmed',
  waiting: 'Confirming your payment',
  failed: 'Your payment did not go through',
  review: 'We are checking this payment',
  ended: 'Your hold ended before the payment completed',
};

/**
 * PAY-01: the only place that tells the traveler a payment worked. It asks the backend for the payment
 * AND the booking (see outcome.ts): Stripe's redirect, its query string and even a SUCCEEDED payment on
 * an expired hold are not a confirmed booking.
 */
export function ResultWatch({ type, bookingId, initialPayment, initialBooking, serverNow, links, retryHref, here, doneLabel }: ResultWatchProps) {
  const [payment, setPayment] = useState(initialPayment);
  const [booking, setBooking] = useState(initialBooking);
  // The server's clock: its time at render plus the time passed here since then.
  const [now, setNow] = useState(serverNow);
  const offset = useRef<number | null>(null);
  const [checks, setChecks] = useState(0);
  const [error, setError] = useState('');
  const [stop, setStop] = useState<Stop>(null);
  const outcome = paymentOutcome(payment, booking, now);
  const stopped = checks >= MAX_CHECKS || stop !== null;

  useEffect(() => {
    if (offset.current === null) offset.current = new Date(serverNow).getTime() - Date.now();
  }, [serverNow]);

  useEffect(() => {
    if (outcome !== 'waiting' || stopped) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      // A hidden tab skips the request but still counts, so the watch ends after about a minute either way.
      if (!document.hidden) {
        const [paid, booked] = await Promise.allSettled([
          apiClient<Payment>(`/payments/${encodeURIComponent(payment._id)}`, { signal: controller.signal }),
          apiClient<Parameters<typeof toBookingState>[0]>(bookingReadPath(type, bookingId), { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        if (paid.status === 'fulfilled') { setPayment(paid.value); setError(''); }
        else if (paid.reason instanceof ApiError && paid.reason.status === 401) setStop({ kind: 'signed-out' });
        else if (paid.reason instanceof ApiError && paid.reason.status === 404) setStop({ kind: 'not-found' });
        else setError('We could not reach the server. We will keep trying.');
        if (booked.status === 'fulfilled') setBooking(toBookingState(booked.value));
      }
      setNow(new Date(Date.now() + (offset.current ?? 0)).toISOString());
      setChecks(count => count + 1);
    }, EVERY_MS);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [outcome, stopped, checks, payment._id, type, bookingId]);

  return (
    <div className="grid gap-4">
      {/* One live region for the whole page, so each change of outcome is announced once. */}
      <p aria-live="polite" className="sr-only">{stop?.kind === 'signed-out' ? 'Your session has ended.' : headlines[outcome]}</p>
      <Body
        outcome={outcome} payment={payment} booking={booking} stop={stop} stopped={stopped} error={error}
        links={links} retryHref={retryHref} here={here} doneLabel={doneLabel} onCheckAgain={() => setChecks(0)}
      />
    </div>
  );
}

function Body({ outcome, payment, booking, stop, stopped, error, links, retryHref, here, doneLabel, onCheckAgain }: {
  outcome: Outcome; payment: Payment; booking: BookingState | null; stop: Stop; stopped: boolean; error: string;
  links: CheckoutLinks; retryHref: string; here: string; doneLabel: string; onCheckAgain: () => void;
}) {
  if (outcome === 'confirmed') {
    return (
      <>
        <div><Badge tone="success">Payment confirmed</Badge></div>
        <h1 className="m-0">{headlines.confirmed}</h1>
        <p className="m-0 text-body">We received {formatPaymentAmount(payment)} and your booking is confirmed.</p>
        <div><Link href={links.done} className={buttonClassName('primary', 'text-white!')}>{doneLabel}</Link></div>
      </>
    );
  }

  if (outcome === 'ended') {
    return (
      <>
        <div><Badge tone="neutral">Hold ended</Badge></div>
        <h1 className="m-0">{headlines.ended}</h1>
        <p className="m-0 text-body">This booking was not confirmed. If you were charged, the full amount is refunded to your payment method.</p>
        <PaymentRefundStatus paymentId={payment._id} refundId={booking?.refundId} currency={payment.currency} />
        <div><Link href={links.back}>Back to booking</Link></div>
      </>
    );
  }

  if (outcome === 'review') {
    return (
      <>
        <div><Badge tone="warning">Under review</Badge></div>
        <h1 className="m-0">{headlines.review}</h1>
        <p className="m-0 text-body">
          The amount Stripe reported does not match your booking, so an administrator will check this payment. Please do not pay
          again; any amount taken by mistake is refunded.
        </p>
        <div><Link href={links.back}>Back to booking</Link></div>
      </>
    );
  }

  if (outcome === 'failed') {
    return (
      <>
        <div><Badge tone="danger">Payment failed</Badge></div>
        <h1 className="m-0">{headlines.failed}</h1>
        <ErrorAlert title="Reason" message={payment.failureReason || 'The payment was declined.'} />
        <p className="m-0 text-sm text-muted">Nothing was charged. You can try again while your booking is still held.</p>
        <div className="flex flex-wrap items-center gap-4">
          <Link href={retryHref} className={buttonClassName('primary', 'text-white!')}>Try again</Link>
          <Link href={links.back}>Back to booking</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div><Badge tone="warning">Processing</Badge></div>
      <h1 className="m-0">{headlines.waiting}</h1>
      {stop?.kind === 'signed-out' ? (
        <div className="grid gap-2">
          <ErrorAlert title="Your session has ended" message="Sign in again to see the status of your payment. You do not need to pay again." />
          <a href={loginHref(here)}>Sign in</a>
        </div>
      ) : stop?.kind === 'not-found' ? (
        <ErrorAlert title="Payment not found" message="This payment is not available. Check your booking for its status." />
      ) : !stopped ? (
        <LoadingState label="Waiting for Stripe to confirm your payment…" />
      ) : (
        <div className="grid gap-3">
          <p className="m-0 text-body">
            Your payment is still processing. We will update your booking as soon as Stripe confirms it; you do not need to pay again.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="secondary" onClick={onCheckAgain}>Check again</Button>
            <Link href={links.back}>Back to booking</Link>
          </div>
        </div>
      )}
      {error && <p className="m-0 text-sm text-muted">{error}</p>}
    </>
  );
}
