'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, buttonClassName } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { loginHref } from '@/config/routes';
import { useSession } from '@/features/auth/session-provider';
import { ApiError, apiClient } from '@/lib/api/client';
import type { Itinerary } from './types';

/**
 * ITN-21 clone: a private, independent copy crediting the author. Guests go to sign in and
 * come back here (ACC-10). Only travelers (role USER) can clone; the backend enforces it.
 */
export function CloneButton({ itineraryId, returnTo }: { itineraryId: string; returnTo: string }) {
  const { user, loading } = useSession();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  if (loading) return null;
  if (!user) return <Link href={loginHref(returnTo)} className={buttonClassName('primary')}>Sign in to clone</Link>;
  if (user.role !== 'USER') return <p className="m-0 text-sm text-muted">Only traveler accounts can clone itineraries.</p>;

  async function clone() {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const copy = await apiClient<Itinerary>(`/itineraries/${encodeURIComponent(itineraryId)}/clone`, { method: 'POST' });
      router.push(`/itineraries/${encodeURIComponent(copy.itineraryId)}/edit?cloned=1`);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 404
        ? 'This itinerary is no longer public, so it cannot be cloned.'
        : cause instanceof Error ? cause.message : 'Please try again.');
      setPending(false);
    }
  }

  return (
    <div className="grid gap-2">
      <Button onClick={clone} disabled={pending}>{pending ? 'Cloning…' : 'Clone to my itineraries'}</Button>
      <p className="m-0 text-xs text-muted">Creates your own private copy with days, activities and budgets.</p>
      {error && <ErrorAlert message={error} />}
    </div>
  );
}
