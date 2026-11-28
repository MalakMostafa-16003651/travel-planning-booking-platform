'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Button, buttonClassName } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError, apiClient } from '@/lib/api/client';
import { isObjectId, type ContentType, type ModerationResult } from './moderation-types';

type Operation = 'hide' | 'unhide' | 'delete';

const types: { value: ContentType; label: string }[] = [
  { value: 'post', label: 'Blog post' },
  { value: 'comment', label: 'Comment' },
  { value: 'review', label: 'Hotel review' },
  { value: 'itinerary', label: 'Public itinerary' },
];

const stateText: Record<ModerationResult['state'], string> = { HIDDEN: 'is now hidden', VISIBLE: 'is visible again', DELETED: 'was deleted' };

/**
 * GEN-10 direct moderation, with or without a report. The admin enters the content type and its ID
 * (shown in the reports list, or copied from the content's own page). Delete asks for confirmation.
 */
export function ContentModeration({ initialType, initialId = '' }: { initialType?: ContentType; initialId?: string }) {
  const busy = useRef(false);
  const confirmRef = useRef<HTMLDialogElement>(null);
  const [type, setType] = useState<ContentType>(initialType ?? 'post');
  const [id, setId] = useState(initialId);
  const [idError, setIdError] = useState('');
  const [pending, setPending] = useState<Operation | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  const label = types.find(entry => entry.value === type)!.label;

  function validId(): string | null {
    const value = id.trim();
    if (!isObjectId(value)) { setIdError('Enter the 24-character ID, for example 6650f1c2a9b8e4d3c2b1a090.'); return null; }
    setIdError('');
    return value;
  }

  async function run(operation: Operation) {
    const value = validId();
    if (!value || busy.current) return;
    busy.current = true;
    setPending(operation);
    setError('');
    setResult('');
    try {
      const path = `/admin/content/${type}/${value}${operation === 'delete' ? '' : `/${operation}`}`;
      const outcome = await apiClient<ModerationResult>(path, { method: operation === 'delete' ? 'DELETE' : 'PATCH' });
      const closed = outcome.closedReports > 0 ? ` ${outcome.closedReports} open report${outcome.closedReports === 1 ? ' was' : 's were'} closed.` : '';
      setResult(`The ${label.toLowerCase()} ${stateText[outcome.state]}.${closed}`);
      confirmRef.current?.close();
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 404
        ? `No ${label.toLowerCase()} with this ID. Check the type and the ID. Private itineraries cannot be moderated.`
        : cause instanceof ApiError ? cause.message : 'Please try again.');
      confirmRef.current?.close();
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  function start(operation: Operation) {
    if (operation === 'delete') {
      if (validId()) confirmRef.current?.showModal();
      return;
    }
    void run(operation);
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={(event: FormEvent<HTMLFormElement>) => event.preventDefault()} noValidate className="grid gap-4 rounded-card border border-border bg-card p-6 md:grid-cols-[minmax(160px,220px)_1fr] md:items-start">
        <div className="grid gap-2">
          <label htmlFor="content-type" className="text-sm font-semibold text-ink">Content type</label>
          <Select id="content-type" value={type} onChange={event => { setType(event.target.value as ContentType); setResult(''); setError(''); }} disabled={pending !== null}>
            {types.map(entry => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </Select>
        </div>
        <div className="grid gap-2">
          <label htmlFor="content-id" className="text-sm font-semibold text-ink">Content ID</label>
          <Input
            id="content-id"
            value={id}
            onChange={event => { setId(event.target.value); if (idError) setIdError(''); }}
            disabled={pending !== null}
            spellCheck={false}
            autoComplete="off"
            maxLength={40}
            aria-invalid={Boolean(idError)}
            aria-describedby={idError ? 'content-id-hint content-id-error' : 'content-id-hint'}
            className="font-mono"
          />
          <p id="content-id-hint" className="m-0 text-sm text-muted">Shown in the reports list. Works for content with or without a report.</p>
          {idError && <p id="content-id-error" className="m-0 text-sm text-danger">{idError}</p>}
        </div>
        <div className="flex flex-wrap gap-3 md:col-span-2">
          <Button onClick={() => start('hide')} disabled={pending !== null}>{pending === 'hide' ? 'Hiding…' : 'Hide'}</Button>
          <Button onClick={() => start('unhide')} variant="secondary" disabled={pending !== null}>{pending === 'unhide' ? 'Unhiding…' : 'Unhide'}</Button>
          <Button onClick={() => start('delete')} variant="danger" disabled={pending !== null}>Delete…</Button>
        </div>
      </form>

      {error && <ErrorAlert message={error} />}
      {result && <p role="status" className="m-0 rounded-control border border-success/25 bg-success/10 p-4 text-sm text-ink">{result}</p>}

      <dialog
        ref={confirmRef}
        aria-labelledby="delete-content-title"
        className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-md overflow-auto rounded-card border border-border bg-card p-6 text-body shadow-xl backdrop:bg-ink/50"
        onCancel={event => { if (busy.current) event.preventDefault(); }}
      >
        <div className="grid gap-4">
          <h2 id="delete-content-title" className="m-0">Delete this {label.toLowerCase()}?</h2>
          <p className="m-0 text-sm text-muted">This cannot be undone. Related data is removed too (for a post, its comments, likes and images). Every open report about it is closed.</p>
          <p className="m-0 break-all font-mono text-sm text-ink">{id.trim()}</p>
          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" onClick={() => { if (!busy.current) confirmRef.current?.close(); }} aria-disabled={pending !== null} className={buttonClassName('secondary')}>Cancel</button>
            <Button variant="danger" disabled={pending !== null} onClick={() => void run('delete')}>{pending === 'delete' ? 'Deleting…' : `Delete ${label.toLowerCase()}`}</Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
