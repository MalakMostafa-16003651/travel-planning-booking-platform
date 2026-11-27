'use client';

import { useId, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClassName } from '@/components/ui/button';
import { Pagination } from '@/components/data-table';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/error-alert';
import { loginHref } from '@/config/routes';
import { useSession } from '@/features/auth/session-provider';
import { ReportAction } from '@/features/reports';
import { ApiError, apiClient } from '@/lib/api/client';
import { formatDate, plural, postHref } from './format';
import { AuthorName } from './post-card';
import { BLOG_LIMITS, type Comment, type Page } from './types';

const MAX = BLOG_LIMITS.commentMax;

/** BLG-05: non-empty after trimming, at most 500 characters (the backend trims too). */
function commentError(text: string): string {
  if (!text.trim()) return 'Write something before posting.';
  if (text.trim().length > MAX) return `Comments can be at most ${MAX} characters.`;
  return '';
}

function messageOf(cause: unknown): string {
  if (cause instanceof ApiError) return cause.fields.content?.[0] ?? cause.message;
  return 'Please try again.';
}

/** A textarea with a live character counter; the counter turns into an error above the limit. */
function CommentField({ id, label, value, onChange, error, disabled }: { id: string; label: string; value: string; onChange: (value: string) => void; error?: string; disabled?: boolean }) {
  const length = value.trim().length;
  const over = length > MAX;
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-ink">{label}</label>
      <textarea
        id={id}
        value={value}
        rows={3}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        aria-invalid={Boolean(error) || over}
        aria-describedby={`${id}-count${error ? ` ${id}-error` : ''}`}
        className="w-full rounded-control border border-border bg-card px-3 py-2.5 text-base text-body aria-invalid:border-danger disabled:bg-canvas"
      />
      <p id={`${id}-count`} className={`m-0 text-sm ${over ? 'font-semibold text-danger' : 'text-muted'}`}>
        {length} / {MAX} characters{over ? ` (${length - MAX} too many)` : ''}
      </p>
      {error && <p id={`${id}-error`} className="m-0 text-sm text-danger">{error}</p>}
    </div>
  );
}

const GONE = 'That comment was already deleted, for example in another tab. The list is up to date again.';

const isGone = (cause: unknown) => cause instanceof ApiError && cause.status === 404;

function CommentItem({ comment, mine, onChanged, onDeleted }: { comment: Comment; mine: boolean; onChanged: (comment: Comment) => void; onDeleted: (note?: string) => Promise<void> }) {
  const fieldId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.content);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const edited = comment.updatedAt !== comment.createdAt;

  async function save(event: FormEvent) {
    event.preventDefault();
    const problem = commentError(draft);
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError('');
    try {
      onChanged(await apiClient<Comment>(`/comments/${encodeURIComponent(comment.commentId)}`, { method: 'PATCH', body: JSON.stringify({ content: draft }) }));
      setEditing(false);
    } catch (cause) {
      // Deleted elsewhere: close the editor and reload the page of comments instead of showing a dead form.
      if (isGone(cause)) { setEditing(false); await onDeleted(GONE); return; }
      setError(messageOf(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="grid min-w-0 gap-2 rounded-card border border-border bg-card p-4" aria-label={`Comment by ${comment.author.name}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm wrap-anywhere">
        <span className="font-semibold text-ink"><AuthorName author={comment.author} /></span>
        <time dateTime={comment.createdAt} className="text-muted">{formatDate(comment.createdAt)}</time>
        {edited && <span className="text-muted">(edited)</span>}
        {comment.isHidden && <Badge tone="warning">Hidden by a moderator; only the author and admins can see it</Badge>}
      </div>
      {editing ? (
        <form onSubmit={save} className="grid gap-3" noValidate>
          <CommentField id={fieldId} label="Edit your comment" value={draft} onChange={setDraft} error={error} disabled={saving} />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={saving || !draft.trim() || draft.trim().length > MAX}>{saving ? 'Saving…' : 'Save comment'}</Button>
            <Button variant="secondary" disabled={saving} onClick={() => { setEditing(false); setDraft(comment.content); setError(''); }}>Cancel</Button>
          </div>
        </form>
      ) : (
        <p className="m-0 max-w-prose whitespace-pre-line wrap-anywhere">{comment.content}</p>
      )}
      {mine && !editing && (
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
          <ConfirmDialog
            triggerLabel="Delete"
            title="Delete this comment?"
            description="Your comment will be removed from the post. This cannot be undone."
            confirmLabel="Delete comment"
            pendingLabel="Deleting…"
            onConfirm={async () => {
              let note: string | undefined;
              try {
                await apiClient<void>(`/comments/${encodeURIComponent(comment.commentId)}`, { method: 'DELETE' });
              } catch (cause) {
                // Already gone (another tab): the goal is reached, so close and reload, like deleting a post.
                if (!isGone(cause)) throw new Error(messageOf(cause));
                note = GONE;
              }
              await onDeleted(note);
            }}
          />
        </div>
      )}
      {/* GEN-09: other people's comments can be reported (guests are sent to sign in). */}
      {!mine && <div className="mt-1"><ReportAction targetType="COMMENT" targetId={comment.commentId} /></div>}
    </article>
  );
}

/**
 * BLG-05 and BLG-07: comments oldest first, ten per server page. Only traveler accounts may comment, and
 * only on a public post; guests are sent to sign in and back to the comments (ACC-10).
 */
export function Comments({ postId, initialPage, open }: { postId: string; initialPage: Page<Comment>; open: boolean }) {
  const { user, loading } = useSession();
  const fieldId = useId();
  const [data, setData] = useState(initialPage);
  const [text, setText] = useState('');
  const [formError, setFormError] = useState('');
  const [listError, setListError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/posts/${encodeURIComponent(postId)}/comments`;

  async function load(page: number) {
    setBusy(true);
    setListError('');
    setNotice('');
    try {
      setData(await apiClient<Page<Comment>>(`${base}?page=${page}`));
    } catch (cause) {
      setListError(cause instanceof Error ? cause.message : 'The comments could not be loaded.');
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = commentError(text);
    if (problem) { setFormError(problem); return; }
    setBusy(true);
    setFormError('');
    try {
      await apiClient<Comment>(base, { method: 'POST', body: JSON.stringify({ content: text }) });
      setText('');
      // Oldest first: the new comment is on the last page.
      setBusy(false);
      await load(Math.max(1, Math.ceil((data.total + 1) / data.pageSize)));
    } catch (cause) {
      setFormError(messageOf(cause));
      setBusy(false);
    }
  }

  async function afterDelete(note?: string) {
    const remaining = data.total - 1;
    await load(Math.min(data.page, Math.max(1, Math.ceil(remaining / data.pageSize))));
    if (note) setNotice(note);
  }

  const here = `${postHref(postId)}#comments`;
  const over = text.trim().length > MAX;

  return (
    <section id="comments" aria-labelledby="comments-heading" className="grid min-w-0 gap-4">
      <h2 id="comments-heading" className="m-0">Comments <span className="text-base font-normal text-muted">({plural(data.total, 'comment')})</span></h2>

      {data.total === 0
        ? <EmptyState title="No comments yet" description={open ? 'Be the first to share a thought.' : undefined} />
        : (
          <ol className="m-0 grid list-none gap-3 p-0" aria-busy={busy}>
            {data.items.map(comment => (
              <li key={comment.commentId} className="min-w-0">
                <CommentItem
                  comment={comment}
                  mine={!!user && comment.author.userId === user.userId}
                  onChanged={changed => setData(current => ({ ...current, items: current.items.map(item => item.commentId === changed.commentId ? changed : item) }))}
                  onDeleted={afterDelete}
                />
              </li>
            ))}
          </ol>
        )}
      {notice && <p role="status" className="m-0 text-sm text-muted">{notice}</p>}
      {listError && <ErrorAlert message={listError} />}
      <Pagination page={data.page} totalPages={data.totalPages} label="Comment pages" onPageChange={page => void load(page)} disabled={busy} />

      {!open ? (
        <p className="m-0 text-sm text-muted">Comments open once the post is published and visible to everyone.</p>
      ) : loading ? null : !user ? (
        <p className="m-0"><Link href={loginHref(here)} className={buttonClassName('secondary', 'text-ink!')}>Sign in to comment</Link></p>
      ) : user.role !== 'USER' ? (
        <p className="m-0 text-sm text-muted">Only traveler accounts can comment.</p>
      ) : (
        <form onSubmit={submit} className="grid gap-3" noValidate>
          <CommentField id={fieldId} label="Add a comment" value={text} onChange={value => { setText(value); setFormError(''); }} error={formError} disabled={busy} />
          <div><Button type="submit" disabled={busy || !text.trim() || over}>{busy ? 'Posting…' : 'Post comment'}</Button></div>
        </form>
      )}
    </section>
  );
}
