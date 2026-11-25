'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClassName } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { LoadingState } from '@/components/ui/loading-state';
import { apiClient } from '@/lib/api/client';
import { formatPaymentAmount } from './money';
import type { CheckoutLinks } from './routes';
import type { Payment } from './types';

const EVERY_MS = 2000;
// About a minute, then the traveler decides. An open tab must not keep an idle session alive forever.
const MAX_CHECKS = 30;

export interface ResultWatchProps {
  /** The payment as the server read it while rendering the page. */
  initial: Payment;
  links: CheckoutLinks;
  /** Back to checkout, which retries a failed payment while the hold lasts. */
  retryHref: string;
  /** "View your ticket", "View your booking"... */
  doneLabel: string;
}

/**
 * PAY-01: the only place that tells the traveler a payment worked, and only from GET /api/payments/:id.
 * Stripe's redirect and query string prove nothing; the backend confirms from the signed webhook or by
 * asking Stripe itself while the payment is PENDING.
 */
export function ResultWatch({ initial, links, retryHref, doneLabel }: ResultWatchProps) {
  const [payment, setPayment] = useState(initial);
  const [checks, setChecks] = useState(0);
  const [error, setError] = useState('');
  const waiting = payment.status === 'PENDING';
  const stopped = checks >= MAX_CHECKS;

  useEffect(() => {
    if (!waiting || stopped) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      // A hidden tab skips the request but still counts, so the watch ends after about a minute either way.
      if (document.hidden) { setChecks(count => count + 1); return; }
      apiClient<Payment>(`/payments/${encodeURIComponent(payment._id)}`, { signal: controller.signal })
        .then(latest => { setPayment(latest); setError(''); })
        .catch(() => { if (!controller.signal.aborted) setError('We could not reach the server. We will keep trying.'); })
        .finally(() => { if (!controller.signal.aborted) setChecks(count => count + 1); });
    }, EVERY_MS);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [waiting, stopped, checks, payment._id]);

  if (payment.status === 'SUCCEEDED') {
    return (
      <div className="grid gap-4">
        <div><Badge tone="success">Payment confirmed</Badge></div>
        <h1 className="m-0">Payment confirmed</h1>
        <p role="status" className="m-0 text-body">We received {formatPaymentAmount(payment)}. Your booking is being updated with this payment.</p>
        <div><Link href={links.done} className={buttonClassName('primary', 'text-white!')}>{doneLabel}</Link></div>
      </div>
    );
  }

  if (payment.status === 'FAILED') {
    return (
      <div className="grid gap-4">
        <div><Badge tone="danger">Payment failed</Badge></div>
        <h1 className="m-0">Your payment did not go through</h1>
        <ErrorAlert title="Reason" message={payment.failureReason || 'The payment was declined.'} />
        <p className="m-0 text-sm text-muted">Nothing was charged. You can try again while your booking is still held.</p>
        <div className="flex flex-wrap items-center gap-4">
          <Link href={retryHref} className={buttonClassName('primary', 'text-white!')}>Try again</Link>
          <Link href={links.back}>Back to booking</Link>
        </div>
      </div>
    );
  }

  if (payment.status === 'REFUNDED') {
    return (
      <div className="grid gap-4">
        <div><Badge tone="info">Refunded</Badge></div>
        <h1 className="m-0">This payment was refunded</h1>
        <p className="m-0 text-body">{formatPaymentAmount(payment)} went back to your payment method, so the booking was not paid.</p>
        <div><Link href={links.back}>Back to booking</Link></div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div><Badge tone="warning">Processing</Badge></div>
      <h1 className="m-0">Confirming your payment</h1>
      {!stopped ? (
        <LoadingState label="Waiting for Stripe to confirm your payment…" />
      ) : (
        <div className="grid gap-3">
          <p role="status" className="m-0 text-body">
            Your payment is still processing. We will update your booking as soon as Stripe confirms it; you do not need to pay again.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="secondary" onClick={() => setChecks(0)}>Check again</Button>
            <Link href={links.back}>Back to booking</Link>
          </div>
        </div>
      )}
      {error && <p className="m-0 text-sm text-muted">{error}</p>}
    </div>
  );
}
