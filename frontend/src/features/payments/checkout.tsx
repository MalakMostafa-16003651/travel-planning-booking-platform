'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookingStepper } from '@/components/booking/booking-stepper';
import { HoldTimer } from '@/components/booking/hold-timer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert } from '@/components/ui/error-alert';
import { LoadingState } from '@/components/ui/loading-state';
import { loginHref } from '@/config/routes';
import { BookingEmailGate, isEmailVerificationRequiredError, verificationPath } from '@/features/auth/email-verification';
import { ApiError, apiClient } from '@/lib/api/client';
import { formatPolicyAmount } from './money';
import { PaymentForm } from './payment-form';
import { PolicyDetails } from './policy-details';
import { checkoutPath, checkoutSteps, resultPath, type CheckoutLinks } from './routes';
import type { BookingPolicies, CheckoutSummary, CheckoutType, Payment, PaymentStart, PolicyAcceptance } from './types';

export interface CheckoutProps {
  type: CheckoutType;
  /** flightBookingId, hotelBookingId or flightBookingChangeId. */
  bookingId: string;
  policies: BookingPolicies;
  summary: CheckoutSummary;
  /** The server's time at render, for HoldTimer. */
  serverNow: string;
  links: CheckoutLinks;
}

const typeLabels: Record<CheckoutType, string> = {
  flight: 'Pay for your flight',
  hotel: 'Pay for your stay',
  'flight-change': 'Pay the fare difference',
};

// Our own backend's 409 for a booking whose last payment failed (payments.service.ts, reuseExisting):
// "The last payment failed. Use POST /api/payments/<id>/retry". It is the only place that id is given.
const FAILED_PAYMENT_MESSAGE = /\/api\/payments\/([0-9a-f]{24})\/retry/u;

function failedPaymentId(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  return FAILED_PAYMENT_MESSAGE.exec(error.message)?.[1] ?? null;
}

function acceptedLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

/** Says what went wrong and what to do next, without losing the page. */
function CheckoutError({ error, returnTo }: { error: unknown; returnTo: string }) {
  if (isEmailVerificationRequiredError(error)) {
    return (
      <div className="grid gap-2">
        <ErrorAlert title="Verify your email first" message="Your email must be verified before you can pay." />
        <a href={verificationPath(returnTo)}>Verify your email</a>
      </div>
    );
  }
  if (error instanceof ApiError && error.status === 401) {
    return (
      <div className="grid gap-2">
        <ErrorAlert title="Your session has ended" message="Sign in again to continue. Your booking stays held until the timer ends." />
        <a href={loginHref(returnTo)}>Sign in</a>
      </div>
    );
  }
  const message = error instanceof Error && error.message ? error.message : 'Something went wrong. Please try again.';
  return <ErrorAlert message={message} />;
}

/**
 * PAY-01 and PAY-02 for flights, hotels and higher-fare flight changes. The amount, currency, policies and
 * hold all come from the server; this component never sends an amount and never decides that a payment
 * succeeded. That is the result page's job, and it asks the backend.
 */
export function Checkout({ type, bookingId, policies, summary, serverNow, links }: CheckoutProps) {
  const router = useRouter();
  const here = checkoutPath(type, bookingId);
  const [checked, setChecked] = useState(false);
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<unknown>(null);
  // The countdown only says "ask the server now". A newer server render (new serverNow) clears it.
  const [expiredAt, setExpiredAt] = useState<string | null>(null);
  const holdEnded = expiredAt === serverNow;
  const amount = formatPolicyAmount(policies);

  async function accept() {
    if (!checked || accepting) return;
    setAccepting(true);
    setAcceptError(null);
    try {
      const acceptance = await apiClient<PolicyAcceptance>(`/bookings/${type}/${encodeURIComponent(bookingId)}/accept-policies`, {
        method: 'POST', body: JSON.stringify({ accepted: true }),
      });
      setAcceptedAt(acceptance.acceptedAt);
    } catch (error) {
      setAcceptError(error);
    } finally {
      setAccepting(false);
    }
  }

  const onExpire = useCallback(() => {
    setExpiredAt(serverNow);
    router.refresh(); // The server decides; if the hold really ended, the page shows that.
  }, [router, serverNow]);

  return (
    <div className="stack">
      <BookingStepper steps={checkoutSteps} current={acceptedAt ? 'pay' : 'policies'} label="Checkout progress" />
      <header className="grid gap-2">
        <Link href={links.back} className="text-sm">Back to booking</Link>
        <h1 className="m-0">{typeLabels[type]}</h1>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
        <div className="grid gap-6">
          <Card className="grid gap-5">
            <h2 className="m-0">1. Review the policies</h2>
            <PolicyDetails type={type} policies={policies.policies} currency={policies.currency} airlineLabels={summary.airlineLabels} />
            {acceptedAt ? (
              <p role="status" className="m-0 rounded-control border border-success/25 bg-success/10 px-4 py-3 text-sm text-ink">
                <strong>Policies accepted</strong> on {acceptedLabel(acceptedAt)}
              </p>
            ) : (
              <div className="grid gap-3">
                <label className="flex min-h-11 items-start gap-3 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="mt-1 size-5 shrink-0"
                    checked={checked}
                    onChange={event => setChecked(event.target.checked)}
                    disabled={accepting || holdEnded}
                  />
                  I have read and accept these cancellation{type === 'hotel' ? ' and stay' : ' and baggage'} policies.
                </label>
                {acceptError !== null && <CheckoutError error={acceptError} returnTo={here} />}
                <div>
                  <Button variant="secondary" onClick={accept} disabled={!checked || accepting || holdEnded}>
                    {accepting ? 'Saving…' : 'Accept policies'}
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card className="grid gap-4">
            <h2 className="m-0">2. Pay</h2>
            {holdEnded ? (
              <LoadingState label="Your hold time is up. Checking with the server…" />
            ) : acceptedAt ? (
              <BookingEmailGate returnTo={here}>
                <PaymentPanel type={type} bookingId={bookingId} amount={amount} returnTo={here} />
              </BookingEmailGate>
            ) : (
              <div className="grid gap-3">
                <p className="m-0 text-sm text-muted">Accept the policies above to continue to payment.</p>
                <Button className="w-full" disabled>Pay {amount}</Button>
              </div>
            )}
          </Card>
        </div>

        <aside aria-label="Payment summary">
          <Card className="grid gap-4">
            <div className="grid gap-1">
              <p className="m-0 text-sm text-muted">You are paying for</p>
              <h2 className="m-0 text-xl">{summary.title}</h2>
            </div>
            <ul className="m-0 grid list-none gap-1 p-0 text-sm text-body">
              {summary.details.map(line => <li key={line}>{line}</li>)}
            </ul>
            <div className="flex items-baseline justify-between gap-3 border-t border-border pt-4">
              <span className="text-sm text-muted">Total to pay</span>
              <strong className="font-heading text-2xl tabular-nums text-ink">{amount}</strong>
            </div>
            <p className="m-0 text-xs text-muted">Charged in {policies.currency}. The amount comes from your booking and cannot change here.</p>
            {summary.holdExpiresAt && (
              <HoldTimer expiresAt={summary.holdExpiresAt} serverNow={serverNow} onExpire={onExpire} label="Held for you" expiredLabel="Your hold has ended" />
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

/** Starts (or resumes, or retries) the payment, then shows Stripe's card form. Mounted inside BookingEmailGate. */
function PaymentPanel({ type, bookingId, amount, returnTo }: { type: CheckoutType; bookingId: string; amount: string; returnTo: string }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState<PaymentStart | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<unknown>(null);
  const [cardError, setCardError] = useState('');
  const startedOnce = useRef(false);

  /** POST /payments returns the open payment again; after a failed one the backend asks for its retry route. */
  const begin = useCallback(async (): Promise<PaymentStart> => {
    try {
      return await apiClient<PaymentStart>('/payments', { method: 'POST', body: JSON.stringify({ bookingType: type, bookingId }) });
    } catch (error) {
      const failedId = failedPaymentId(error);
      if (!failedId) throw error;
      return apiClient<PaymentStart>(`/payments/${failedId}/retry`, { method: 'POST' });
    }
  }, [type, bookingId]);

  const start = useCallback(async (previous?: Payment) => {
    setStarting(true);
    setStartError(null);
    setCardError('');
    try {
      if (previous) {
        // GET re-checks a PENDING payment with Stripe, so a decline is recorded as FAILED before we
        // ask again. That makes the next step a clean retry with a new PaymentIntent.
        const latest = await apiClient<Payment>(`/payments/${previous._id}`);
        if (latest.status === 'SUCCEEDED') { router.push(resultPath(type, bookingId, latest._id)); return; }
      }
      setAttempt(await begin());
    } catch (error) {
      setStartError(error);
    } finally {
      setStarting(false);
    }
  }, [begin, router, type, bookingId]);

  useEffect(() => {
    // Once per mount; the ref survives React's development double effect.
    if (startedOnce.current) return;
    startedOnce.current = true;
    void start();
  }, [start]);

  if (starting) return <LoadingState label="Preparing a secure payment…" />;
  if (startError !== null) {
    return (
      <div className="grid gap-3">
        <CheckoutError error={startError} returnTo={returnTo} />
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="secondary" onClick={() => void start(attempt?.payment)}>Try again</Button>
          {/* A full load, so changed policies or a new booking status are read again. */}
          <a href={returnTo}>Reload checkout</a>
        </div>
      </div>
    );
  }
  if (!attempt) return null;
  if (cardError) {
    return (
      <div className="grid gap-3">
        <ErrorAlert title="Your payment did not go through" message={cardError} />
        <p className="m-0 text-sm text-muted">Nothing was charged. You can try again, with the same or another card, while your booking is held.</p>
        <div><Button onClick={() => void start(attempt.payment)}>Try again</Button></div>
      </div>
    );
  }

  const paymentId = attempt.payment._id;
  return (
    <PaymentForm
      clientSecret={attempt.clientSecret}
      returnUrl={`${window.location.origin}${resultPath(type, bookingId, paymentId)}`}
      payLabel={`Pay ${amount}`}
      onSubmitted={() => router.push(resultPath(type, bookingId, paymentId))}
      onFailed={setCardError}
    />
  );
}
