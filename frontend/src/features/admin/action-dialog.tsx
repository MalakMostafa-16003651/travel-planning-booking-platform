'use client';

import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, buttonClassName, type ButtonVariant } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';

/**
 * Admin action with a confirmation form (GEN-03). The trigger opens a modal; submit runs once at
 * a time; errors stay in the dialog with the typed values; success closes it. Field-level errors
 * are thrown as FieldError so they appear under the right field.
 */
export class FieldError extends Error {
  constructor(public field: string, message: string) { super(message); }
}

export function ActionDialog({ triggerLabel, triggerAriaLabel, triggerVariant = 'secondary', title, description, submitLabel, pendingLabel = 'Saving…', submitVariant = 'primary', onSubmit, onOpen, children }: {
  triggerLabel: string;
  /** Full accessible name when the visible label repeats on the page, for example "Suspend Nour Hassan". */
  triggerAriaLabel?: string;
  triggerVariant?: ButtonVariant;
  title: string;
  description: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  submitVariant?: ButtonVariant;
  /** Throw FieldError for a field message, or Error for a general message. */
  onSubmit: (form: FormData) => Promise<void>;
  onOpen?: () => void;
  children?: (fieldErrors: Record<string, string>) => ReactNode;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function open() {
    setError('');
    setFieldErrors({});
    formRef.current?.reset();
    onOpen?.();
    dialogRef.current?.showModal();
    const first = formRef.current?.querySelector<HTMLElement>('input, textarea, select');
    (first ?? formRef.current?.querySelector<HTMLElement>('button'))?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    setFieldErrors({});
    try {
      await onSubmit(new FormData(event.currentTarget));
      formRef.current?.reset();
      dialogRef.current?.close();
    } catch (cause) {
      if (cause instanceof FieldError) setFieldErrors({ [cause.field]: cause.message });
      else setError(cause instanceof Error && cause.message ? cause.message : 'Please try again.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <Button variant={triggerVariant} onClick={open} aria-haspopup="dialog" aria-label={triggerAriaLabel}>{triggerLabel}</Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-md overflow-auto rounded-card border border-border bg-card p-6 text-left text-body shadow-xl backdrop:bg-ink/50"
        onCancel={event => { if (busy.current) event.preventDefault(); }}
      >
        <form ref={formRef} className="grid gap-4 whitespace-normal" onSubmit={submit} onInput={() => { if (Object.keys(fieldErrors).length) setFieldErrors({}); }} noValidate>
          <h2 id={`${id}-title`} className="m-0">{title}</h2>
          <div id={`${id}-description`} className="text-sm text-muted">{description}</div>
          {children && <fieldset disabled={pending} className="m-0 grid min-w-0 gap-4 border-0 p-0">{children(fieldErrors)}</fieldset>}
          {error && <ErrorAlert message={error} />}
          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" onClick={() => { if (!busy.current) dialogRef.current?.close(); }} aria-disabled={pending} className={buttonClassName('secondary', pending ? 'cursor-not-allowed opacity-60' : '')}>Cancel</button>
            <Button type="submit" variant={submitVariant} disabled={pending}>{pending ? pendingLabel : submitLabel}</Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/** A labelled field for ActionDialog forms, with hint and error wired to the control. */
export function DialogField({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: (describedBy: string | undefined, invalid: boolean) => ReactNode }) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-ink">{label}</label>
      {children(describedBy, Boolean(error))}
      {hint && <p id={`${id}-hint`} className="m-0 text-sm text-muted">{hint}</p>}
      {error && <p id={`${id}-error`} className="m-0 text-sm text-danger">{error}</p>}
    </div>
  );
}
