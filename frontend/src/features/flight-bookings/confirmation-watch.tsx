'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/loading-state';

const EVERY_MS = 4000;
// Two minutes, then the traveler decides. An open tab must not keep an idle session alive.
const MAX_CHECKS = 30;

/**
 * Waits for the backend to confirm a paid booking. Stripe's webhook can arrive after the traveler does,
 * and only the server's own status counts: returning from payment proves nothing (PAY-01, FLT-23).
 */
export function ConfirmationWatch() {
  const router = useRouter();
  const [checks, setChecks] = useState(0);
  const stopped = checks >= MAX_CHECKS;

  useEffect(() => {
    if (stopped) return;
    const timer = window.setTimeout(() => {
      setChecks(current => current + 1);
      if (!document.hidden) router.refresh();
    }, EVERY_MS);
    return () => window.clearTimeout(timer);
  }, [checks, stopped, router]);

  if (!stopped) return <LoadingState label="Waiting for your payment to be verified…" />;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="m-0 text-sm text-body">Your payment has not been verified yet.</p>
      <Button variant="secondary" onClick={() => { setChecks(0); router.refresh(); }}>Check again</Button>
    </div>
  );
}
