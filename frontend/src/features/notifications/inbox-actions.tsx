'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError, apiClient } from '@/lib/api/client';
import { NOTIFICATIONS_CHANGED } from './types';

/** Shared mutation flow: one request at a time, then re-read the server page and the bell. */
function useInboxMutation() {
  const router = useRouter();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function run(path: string) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      await apiClient(path, { method: 'PATCH' });
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 404 ? 'This notification is no longer in your inbox.' : cause instanceof ApiError ? cause.message : 'Please try again.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return { run, pending, error };
}

export function MarkReadButton({ notificationId }: { notificationId: string }) {
  const { run, pending, error } = useInboxMutation();
  return (
    <div className="grid justify-items-end gap-1">
      <button type="button" disabled={pending} onClick={() => void run(`/notifications/${notificationId}/read`)} className="min-h-11 rounded-control px-2 text-sm font-semibold text-primary hover:underline disabled:opacity-60">
        {pending ? 'Marking…' : 'Mark as read'}
      </button>
      {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
    </div>
  );
}

export function MarkAllReadButton() {
  const { run, pending, error } = useInboxMutation();
  return (
    <div className="grid justify-items-start gap-1">
      <Button variant="secondary" disabled={pending} onClick={() => void run('/notifications/read-all')}>
        {pending ? 'Marking…' : 'Mark all as read'}
      </Button>
      {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
    </div>
  );
}

/** Shows a server timestamp in the viewer's own time zone. */
export function LocalTime({ iso }: { iso: string }) {
  const date = new Date(iso);
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
    </time>
  );
}
