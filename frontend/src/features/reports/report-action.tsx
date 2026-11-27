'use client';

import { Check, Flag } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Button, buttonClassName } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { loginHref } from '@/config/routes';
import { useSession } from '@/features/auth/session-provider';
import { ApiError, apiClient } from '@/lib/api/client';

/** API names from POST /api/reports (backend/src/reports/dto/create-report.dto.ts). */
export type ReportTargetType = 'POST' | 'COMMENT' | 'REVIEW' | 'ITINERARY';

export interface ReportActionProps {
  targetType: ReportTargetType;
  /** The item's own ID: post, comment, review or itinerary ID. */
  targetId: string;
  /** Called once after the report is stored (201), for example to show a note or refresh. */
  onReported?: () => void;
}

const REASON_MIN = 5;
const REASON_MAX = 500;

const nouns: Record<ReportTargetType, string> = { POST: 'post', COMMENT: 'comment', REVIEW: 'review', ITINERARY: 'itinerary' };

/**
 * GEN-09 shared report button, built by Arwa (Person 2). Mount it next to any post, comment,
 * review or public itinerary. Travelers report with a reason; guests are sent to sign in and
 * return to the same page; administrators and moderators do not see it (admins moderate
 * directly from /admin). The backend decides what can be reported and enforces one report per
 * person per item.
 */
export function ReportAction({ targetType, targetId, onReported }: ReportActionProps) {
  const { user, loading } = useSession();
  const router = useRouter();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState<'' | 'reported' | 'already'>('');
  const noun = nouns[targetType];

  if (loading) return null;
  if (user && user.role !== 'USER') return null;

  if (done) {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-sm text-muted">
        <Check size={16} aria-hidden="true" />
        {done === 'reported' ? 'Reported. Thank you.' : `You already reported this ${noun}.`}
      </span>
    );
  }

  function open() {
    if (!user) {
      router.push(loginHref(window.location.pathname + window.location.search + window.location.hash));
      return;
    }
    setError('');
    setFieldError('');
    dialogRef.current?.showModal();
    textareaRef.current?.focus();
  }

  function close() {
    if (!submitting.current) dialogRef.current?.close();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN || trimmed.length > REASON_MAX) {
      setFieldError(`Reason must be ${REASON_MIN} to ${REASON_MAX} characters.`);
      textareaRef.current?.focus();
      return;
    }
    submitting.current = true;
    setPending(true);
    setError('');
    setFieldError('');
    try {
      await apiClient('/reports', { method: 'POST', body: JSON.stringify({ targetType, targetId, reason: trimmed }) });
      dialogRef.current?.close();
      setDone('reported');
      onReported?.();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        dialogRef.current?.close();
        setDone('already');
      } else if (cause instanceof ApiError && cause.status === 400 && cause.fields.reason?.length) {
        setFieldError(cause.fields.reason[0]);
      } else {
        setError(messageFor(cause, noun));
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  const count = reason.trim().length;
  const describedBy = [`${id}-hint`, fieldError ? `${id}-error` : ''].filter(Boolean).join(' ');

  return (
    <>
      <button type="button" onClick={open} aria-haspopup={user ? 'dialog' : undefined} className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-2 text-sm font-semibold text-muted hover:text-danger">
        <Flag size={16} aria-hidden="true" />
        Report<span className="sr-only"> this {noun}</span>
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={`${id}-title`}
        className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-md overflow-auto rounded-card border border-border bg-card p-6 text-body shadow-xl backdrop:bg-ink/50"
        onCancel={event => { if (submitting.current) event.preventDefault(); }}
      >
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <h2 id={`${id}-title`} className="m-0">Report this {noun}</h2>
          <p className="m-0 text-sm text-muted">An administrator will review it. The author is not told who reported it.</p>
          <div className="grid gap-2">
            <label htmlFor={`${id}-reason`} className="text-sm font-semibold text-ink">Reason</label>
            <textarea
              ref={textareaRef}
              id={`${id}-reason`}
              name="reason"
              rows={4}
              maxLength={REASON_MAX}
              value={reason}
              disabled={pending}
              onChange={event => { setReason(event.target.value); if (fieldError) setFieldError(''); }}
              aria-invalid={Boolean(fieldError)}
              aria-describedby={describedBy}
              className="w-full rounded-control border border-border bg-card px-3 py-2.5 text-base text-body aria-invalid:border-danger disabled:bg-canvas"
            />
            <p id={`${id}-hint`} className="m-0 text-sm text-muted">{REASON_MIN} to {REASON_MAX} characters ({count}/{REASON_MAX})</p>
            {fieldError && <p id={`${id}-error`} className="m-0 text-sm text-danger">{fieldError}</p>}
          </div>
          {error && <ErrorAlert message={error} />}
          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" onClick={close} aria-disabled={pending} className={buttonClassName('secondary', pending ? 'cursor-not-allowed opacity-60' : '')}>Cancel</button>
            <Button type="submit" variant="danger" disabled={pending}>{pending ? 'Sending…' : 'Send report'}</Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

function messageFor(cause: unknown, noun: string): string {
  if (!(cause instanceof ApiError)) return 'Please try again.';
  switch (cause.status) {
    case 401: return 'Your session has ended. Sign in again to report.';
    case 403: return 'Only traveler accounts can report content.';
    case 404: return `This ${noun} is no longer available, so it can't be reported.`;
    default: return cause.message || 'Please try again.';
  }
}
