'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
// The "pure" entry loads Stripe.js only when loadStripe is called, so other pages never fetch it.
import { loadStripe } from '@stripe/stripe-js/pure';
import type { Stripe } from '@stripe/stripe-js';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { LoadingState } from '@/components/ui/loading-state';

// A publishable key is public by design, but it is configuration, so it comes from the environment.
// NEXT_PUBLIC_ values are fixed when `next build` runs.
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(): Promise<Stripe | null> {
  stripePromise ??= loadStripe(publishableKey).catch(() => {
    stripePromise = null; // A later visit may try again.
    return null;
  });
  return stripePromise;
}

export interface PaymentFormProps {
  clientSecret: string;
  /** Where Stripe sends the traveler back after a redirect (3-D Secure, bank pages). It verifies with the backend. */
  returnUrl: string;
  payLabel: string;
  /**
   * Stripe accepted the payment details, or this PaymentIntent was already submitted earlier (the traveler
   * came back with the Back button). This is NOT a confirmed payment: the result page asks the backend.
   */
  onSubmitted: () => void;
  /** The card was declined or Stripe failed. The payment must be started again (see checkout.tsx). */
  onFailed: (message: string) => void;
}

/**
 * PAY-01 with Stripe Elements: card details go straight from the browser to Stripe in Stripe's own
 * iframe. Our backend only ever sees the booking id; it creates the PaymentIntent and learns the
 * outcome from Stripe (signed webhook, or its own check in GET /api/payments/:id).
 */
export function PaymentForm(props: PaymentFormProps) {
  const [stripe, setStripe] = useState<Stripe | null | 'loading'>('loading');

  useEffect(() => {
    if (!publishableKey) return;
    let active = true;
    void getStripe().then(loaded => { if (active) setStripe(loaded); });
    return () => { active = false; };
  }, []);

  if (!publishableKey) {
    return <ErrorAlert title="Payments are not configured" message="Card payments are not available on this site right now. Your booking is still held; please try again later." />;
  }
  if (stripe === 'loading') return <LoadingState label="Loading the secure card form…" />;
  if (!stripe) {
    return <ErrorAlert title="The card form could not be loaded" message="Check your connection, then reload this page. Your booking is still held until the timer ends." />;
  }
  // A new clientSecret (after a retry) is a new PaymentIntent, so Elements is mounted again for it.
  return (
    <Elements key={props.clientSecret} stripe={stripe} options={{ clientSecret: props.clientSecret }}>
      <CardForm {...props} />
    </Elements>
  );
}

// Intent states in which the payment was already submitted: paying again would only fail at Stripe.
const SUBMITTED_STATES = ['processing', 'succeeded', 'requires_capture'];

function CardForm({ clientSecret, returnUrl, payLabel, onSubmitted, onFailed }: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [fieldError, setFieldError] = useState('');
  // A ref, not only state: a quick double click arrives before React re-renders the disabled button.
  const busy = useRef(false);
  // Pay stays off until Stripe says whether this intent can still be paid.
  const [intentChecked, setIntentChecked] = useState(false);
  const submittedRef = useRef(onSubmitted);
  useEffect(() => { submittedRef.current = onSubmitted; }, [onSubmitted]);

  useEffect(() => {
    if (!stripe) return;
    let active = true;
    stripe.retrievePaymentIntent(clientSecret)
      .then(({ paymentIntent }) => {
        if (!active) return;
        if (paymentIntent && SUBMITTED_STATES.includes(paymentIntent.status)) {
          busy.current = true;
          setSubmitted(true);
          submittedRef.current();
          return;
        }
        setIntentChecked(true);
      })
      // Stripe could not be asked: let the traveler try; confirmPayment reports a wrong state itself.
      .catch(() => { if (active) setIntentChecked(true); });
    return () => { active = false; };
  }, [stripe, clientSecret]);

  async function pay(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements || busy.current || !intentChecked) return;
    busy.current = true;
    setPaying(true);
    setFieldError('');
    let error: { type?: string; code?: string; message?: string } | undefined;
    try {
      // redirect 'if_required': cards finish here; 3-D Secure and bank methods come back to returnUrl.
      ({ error } = await stripe.confirmPayment({ elements, redirect: 'if_required', confirmParams: { return_url: returnUrl } }));
    } catch {
      error = { message: 'We could not reach Stripe. Check your connection and try again.' };
    }
    setPaying(false);
    // payment_intent_unexpected_state: this intent was already submitted (for example in another tab).
    // The money may be on its way, so the result page checks instead of saying "nothing was charged".
    if (!error || error.code === 'payment_intent_unexpected_state') {
      // Stays locked while the result page opens: the same payment must never be submitted twice.
      setSubmitted(true);
      onSubmitted();
      return;
    }
    busy.current = false; // After an error the traveler can always act again.
    // Incomplete or invalid fields: nothing was charged and the same form can be corrected.
    if (error.type === 'validation_error') setFieldError(error.message ?? 'Check your card details.');
    else onFailed(error.message ?? 'Your payment did not go through.');
  }

  return (
    <form className="grid gap-4" onSubmit={pay} aria-label="Card payment" noValidate>
      {!ready && <LoadingState label="Loading the secure card form…" />}
      <PaymentElement onReady={() => setReady(true)} onLoadError={() => onFailed('The card form could not be loaded. Please try again.')} />
      {fieldError && <p role="alert" className="m-0 text-sm text-danger">{fieldError}</p>}
      <Button type="submit" className="w-full" disabled={!ready || !intentChecked || !stripe || !elements || paying || submitted} aria-busy={paying || submitted}>
        {submitted ? 'Checking your payment…' : paying ? 'Processing your payment…' : payLabel}
      </Button>
      <p className="m-0 text-xs text-muted">Card details are entered in Stripe’s secure form and are never sent to or stored by us.</p>
    </form>
  );
}
