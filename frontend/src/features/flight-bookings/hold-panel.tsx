'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { HoldTimer } from '@/components/booking/hold-timer';
import { BookingEmailGate } from '@/features/auth/email-verification';
import { money } from './format';
import { LinkButton } from './link-button';

/** A live Pending Payment hold (FLT-22). Hicham's checkout owns policies and payment. */
export function HoldPanel({ bookingId, expiresAt, serverNow, totalAmount, currency }: {
  bookingId: string;
  expiresAt: string;
  serverNow: string;
  totalAmount: number;
  currency: string;
}) {
  const router = useRouter();
  const [ended, setEnded] = useState(false);

  return (
    <section aria-label="Payment" className="grid gap-4">
      <HoldTimer
        expiresAt={expiresAt}
        serverNow={serverNow}
        label="Your seats are held for"
        expiredLabel="Your hold has ended and the seats were released"
        onExpire={() => { setEnded(true); router.refresh(); }}
      />
      {ended ? (
        <LinkButton href="/flights">Search flights again</LinkButton>
      ) : (
        <>
          <BookingEmailGate returnTo={`/bookings/flights/${bookingId}`}>
            <LinkButton href={`/checkout/flight/${bookingId}`} className="w-full">Continue to payment · {money(totalAmount, currency)}</LinkButton>
          </BookingEmailGate>
          <p className="m-0 text-sm text-muted">You accept the airline’s policies and pay on the next page. If you do not pay in time, the seats are released and nothing is charged.</p>
        </>
      )}
    </section>
  );
}
