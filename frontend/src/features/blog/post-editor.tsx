'use client';

import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/error-alert';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { MediaUploader, type MediaItem } from '@/features/media/media-uploader';
import { ApiError, apiClient, uploadFile } from '@/lib/api/client';
import { useDropQueryParam } from './flash-notice';
import { plural, postHref } from './format';
import { BLOG_LIMITS, type AuthorProfile, type ItinerarySummary, type Post, type PostStatus } from './types';

type Errors = Partial<Record<'title' | 'content' | 'tags' | 'itineraryId' | 'form', string>>;

const MAX_ITINERARY_PAGES = 5;

/** The same normalisation as the backend DTO: trimmed and lowercased. */
const normalizeTag = (tag: string) => tag.trim().toLowerCase();

function validate(title: string, content: string): Errors {
  const errors: Errors = {};
  const titleLength = title.trim().length;
  if (titleLength === 0) errors.title = 'Enter a title.';
  else if (titleLength < BLOG_LIMITS.titleMin || titleLength > BLOG_LIMITS.titleMax) errors.title = `The title must be ${BLOG_LIMITS.titleMin} to ${BLOG_LIMITS.titleMax} characters.`;
  const contentLength = content.trim().length;
  if (contentLength === 0) errors.content = 'Write the story before saving.';
  else if (contentLength > BLOG_LIMITS.contentMax) errors.content = `The story can be at most ${BLOG_LIMITS.contentMax.toLocaleString('en')} characters.`;
  return errors;
}

/** Field errors from the backend (`errors` in the API error body). Nested tag paths such as `tags.0` count as tags. */
function serverErrors(cause: unknown): Errors {
  if (!(cause instanceof ApiError)) return { form: 'Please try again.' };
  const errors: Errors = {};
  for (const [field, messages] of Object.entries(cause.fields)) {
    const key = field.startsWith('tags') ? 'tags' : field;
    if (key === 'title' || key === 'content' || key === 'tags' || key === 'itineraryId') errors[key] = messages[0];
  }
  if (Object.keys(errors).length === 0) errors.form = cause.status === 403 ? 'You can only change your own posts with a traveler account.' : cause.message;
  return errors;
}

/**
 * BLG-13 (bonus): the author's own PUBLIC itineraries, read from their public author page, which lists
 * exactly the itineraries the backend accepts for attachment.
 * TODO(after PR #148): replace this select with Kiki's ItineraryPicker from '@/features/itineraries/itinerary-picker'.
 */
function useOwnPublicItineraries(userId: string) {
  const [items, setItems] = useState<ItinerarySummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    (async () => {
      const found: ItinerarySummary[] = [];
      for (let page = 1; page <= MAX_ITINERARY_PAGES; page += 1) {
        const author = await apiClient<AuthorProfile>(`/authors/${encodeURIComponent(userId)}?itinerariesPage=${page}`);
        found.push(...author.itineraries.items);
        if (page >= author.itineraries.totalPages) break;
      }
      if (active) setItems(found);
    })().catch(() => { if (active) { setFailed(true); setItems([]); } });
    return () => { active = false; };
  }, [userId]);
  return { items, failed };
}

const itineraryLabel = (itinerary: ItinerarySummary) =>
  `${itinerary.title}${itinerary.cities.length ? ` (${itinerary.cities.join(', ')})` : ''}, ${plural(itinerary.dayCount, 'day')}`;

/**
 * BLG-01, BLG-04, BLG-08, BLG-10 and BLG-13: one editor for new and existing posts. A new post is saved
 * first; images are then added on its edit page, because the image endpoints need the post id.
 */
export function PostEditor({ userId, post, notice }: { userId: string; post?: Post; notice?: string }) {
  const router = useRouter();
  const id = useId();
  const [saved, setSaved] = useState<Post | undefined>(post);
  const [title, setTitle] = useState(post?.title ?? '');
  const [content, setContent] = useState(post?.content ?? '');
  const [tags, setTags] = useState<string[]>(post?.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [itineraryId, setItineraryId] = useState(post?.itinerary?.itineraryId ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState<PostStatus | null>(null);
  const [message, setMessage] = useState(notice ?? '');
  const itineraries = useOwnPublicItineraries(userId);
  // The "saved" notice came in the URL (?saved=draft); drop it so a reload does not repeat it.
  useDropQueryParam('saved');

  const status = saved?.status ?? 'DRAFT';
  const images = saved?.images ?? [];

  /** Adds the typed tag; a pasted list such as "nile, luxor" becomes separate tags. Stops at the first problem. */
  function addTag() {
    const candidates = tagInput.split(',').map(normalizeTag).filter(Boolean);
    const next = [...tags];
    let problem = '';
    let used = 0;
    for (const tag of candidates) {
      if (tag.length > BLOG_LIMITS.tagMax) problem = `Each tag can be at most ${BLOG_LIMITS.tagMax} characters.`;
      else if (next.includes(tag)) problem = `“${tag}” is already added.`;
      else if (next.length >= BLOG_LIMITS.maxTags) problem = `A post can have at most ${BLOG_LIMITS.maxTags} tags.`;
      if (problem) break;
      next.push(tag);
      used += 1;
    }
    setTags(next);
    // Keep the tags that could not be added in the field, so nothing typed is lost silently.
    setTagInput(candidates.slice(used).join(', '));
    setErrors(current => ({ ...current, tags: problem || undefined }));
  }

  function onTagKey(event: KeyboardEvent<HTMLInputElement>) {
    // Enter or comma adds the tag instead of submitting the whole post.
    if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addTag(); }
  }

  async function save(nextStatus: PostStatus) {
    const problems = validate(title, content);
    if (tagInput.trim()) problems.tags = 'Add or clear the tag you are typing first.';
    setErrors(problems);
    setMessage('');
    if (Object.keys(problems).length > 0) return;
    setSaving(nextStatus);
    const body: Record<string, unknown> = { title, content, tags, status: nextStatus };
    // Only send the itinerary when it changed, so an unchanged post never re-checks it; '' detaches it.
    const initial = saved?.itinerary?.itineraryId ?? '';
    if (!saved && itineraryId) body.itineraryId = itineraryId;
    if (saved && itineraryId !== initial) body.itineraryId = itineraryId || null;
    try {
      const result = await apiClient<Post>(saved ? `/posts/${encodeURIComponent(saved.postId)}` : '/posts', {
        method: saved ? 'PATCH' : 'POST', body: JSON.stringify(body),
      });
      if (!saved) {
        router.push(`${postHref(result.postId)}/edit?saved=${result.status === 'PUBLISHED' ? 'published' : 'draft'}`);
        return;
      }
      setSaved(result);
      setItineraryId(result.itinerary?.itineraryId ?? '');
      setMessage(result.status === 'PUBLISHED' ? 'Your changes are published.' : 'Saved as a draft. Only you can see it.');
      router.refresh();
    } catch (cause) {
      setErrors(serverErrors(cause));
    } finally {
      setSaving(null);
    }
  }

  async function uploadImage(file: File, onProgress: (percent: number) => void): Promise<MediaItem> {
    if (!saved) throw new Error('Save the post first.');
    const before = new Set(images.map(image => image.imageId));
    let result: Post;
    try {
      result = await uploadFile<Post>(`/posts/${encodeURIComponent(saved.postId)}/images`, 'image', file, onProgress);
    } catch (cause) {
      // The backend's message is the generic "Validation failed"; the reason is in the `image` field error.
      if (cause instanceof ApiError) throw new ApiError(cause.status, cause.fields.image?.[0] ?? cause.message, cause.fields);
      throw cause;
    }
    setSaved(result);
    const added = result.images.find(image => !before.has(image.imageId)) ?? result.images[result.images.length - 1];
    return { id: added.imageId, url: added.url };
  }

  async function removeImage(item: MediaItem) {
    if (!saved) return;
    setSaved(await apiClient<Post>(`/posts/${encodeURIComponent(saved.postId)}/images/${encodeURIComponent(item.id)}`, { method: 'DELETE' }));
  }

  const titleLength = title.trim().length;
  const contentLength = content.trim().length;
  const busy = saving !== null;

  return (
    // Enter in a text field keeps the current status (a new post is saved as a draft, never published by accident).
    <form className="grid max-w-3xl gap-6" noValidate onSubmit={(event: FormEvent) => { event.preventDefault(); if (!busy) void save(status); }}>
      {message && <p role="status" className="m-0 rounded-control border border-success/25 bg-success/10 p-4 text-sm text-ink">{message} {saved && <Link href={postHref(saved.postId)}>View post</Link>}</p>}
      {errors.form && <ErrorAlert message={errors.form} />}

      <FormField id={`${id}-title`} label="Title" error={errors.title} hint={`${titleLength} / ${BLOG_LIMITS.titleMax} characters, at least ${BLOG_LIMITS.titleMin}.`}>
        <Input value={title} onChange={event => setTitle(event.target.value)} disabled={busy} required />
      </FormField>

      <FormField id={`${id}-content`} label="Story" error={errors.content} hint={`${contentLength.toLocaleString('en')} / ${BLOG_LIMITS.contentMax.toLocaleString('en')} characters. Leave a blank line between paragraphs.`}>
        <textarea
          value={content}
          onChange={event => setContent(event.target.value)}
          disabled={busy}
          rows={14}
          required
          className="w-full rounded-control border border-border bg-card px-3 py-2.5 text-base leading-relaxed text-body aria-invalid:border-danger disabled:bg-canvas"
        />
      </FormField>

      <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
        <legend className="mb-2 p-0 text-sm font-semibold text-ink">Tags (optional)</legend>
        {tags.length > 0 && (
          <ul aria-label="Added tags" className="m-0 flex list-none flex-wrap gap-2 p-0">
            {tags.map(tag => (
              <li key={tag} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-primary/25 bg-primary/10 pl-3 text-sm font-semibold text-ink">
                #{tag}
                <button
                  type="button"
                  onClick={() => setTags(tags.filter(item => item !== tag))}
                  disabled={busy}
                  aria-label={`Remove tag ${tag}`}
                  className="inline-flex size-11 items-center justify-center rounded-full border-0 bg-transparent text-ink"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <label htmlFor={`${id}-tag`} className="sr-only">New tag</label>
          <Input
            id={`${id}-tag`}
            value={tagInput}
            onChange={event => { setTagInput(event.target.value); setErrors(current => ({ ...current, tags: undefined })); }}
            onKeyDown={onTagKey}
            disabled={busy}
            placeholder="e.g. egypt"
            aria-invalid={Boolean(errors.tags)}
            aria-describedby={`${id}-tag-hint${errors.tags ? ` ${id}-tag-error` : ''}`}
            className="max-w-xs flex-1"
          />
          <Button variant="secondary" onClick={addTag} disabled={busy}>Add tag</Button>
        </div>
        <p id={`${id}-tag-hint`} className="m-0 text-sm text-muted">{tags.length} / {BLOG_LIMITS.maxTags} tags, up to {BLOG_LIMITS.tagMax} characters each. Press Enter to add.</p>
        {errors.tags && <p id={`${id}-tag-error`} className="m-0 text-sm text-danger">{errors.tags}</p>}
      </fieldset>

      <FormField
        id={`${id}-itinerary`}
        label="Attach an itinerary (optional)"
        error={errors.itineraryId}
        hint={itineraries.failed
          ? 'Your itineraries could not be loaded. You can attach one later.'
          : itineraries.items?.length === 0 && !itineraryId ? 'You have no public itineraries yet. Only your own public itineraries can be attached.' : 'Only your own public itineraries can be attached.'}
      >
        <Select value={itineraryId} onChange={event => setItineraryId(event.target.value)} disabled={busy || itineraries.items === null}>
          <option value="">{itineraries.items === null ? 'Loading your itineraries…' : 'No itinerary'}</option>
          {saved?.itinerary && !itineraries.items?.some(item => item.itineraryId === saved.itinerary!.itineraryId) && (
            <option value={saved.itinerary.itineraryId}>{itineraryLabel(saved.itinerary)}</option>
          )}
          {itineraries.items?.map(item => <option key={item.itineraryId} value={item.itineraryId}>{itineraryLabel(item)}</option>)}
        </Select>
      </FormField>

      <section aria-label="Images" className="grid gap-2">
        {saved ? (
          <MediaUploader
            label="Post images"
            value={images.map(image => ({ id: image.imageId, url: image.url }))}
            maxCount={BLOG_LIMITS.maxImages}
            onUpload={uploadImage}
            onRemove={removeImage}
            disabled={busy}
            helpText={`JPG or PNG, up to 5 MB each, at most ${BLOG_LIMITS.maxImages} images. Images are saved straight away.`}
          />
        ) : (
          <>
            <p className="m-0 text-sm font-semibold text-ink">Images (optional)</p>
            <p className="m-0 text-sm text-muted">Save the post as a draft or publish it, then add up to {BLOG_LIMITS.maxImages} JPG or PNG images (5 MB each).</p>
          </>
        )}
      </section>

      <div className="flex flex-wrap gap-3">
        {status === 'PUBLISHED' && saved ? (
          <>
            <Button onClick={() => void save('PUBLISHED')} disabled={busy}>{saving === 'PUBLISHED' ? 'Saving…' : 'Save changes'}</Button>
            <Button variant="secondary" onClick={() => void save('DRAFT')} disabled={busy}>{saving === 'DRAFT' ? 'Saving…' : 'Move to drafts'}</Button>
          </>
        ) : (
          <>
            <Button onClick={() => void save('PUBLISHED')} disabled={busy}>{saving === 'PUBLISHED' ? 'Publishing…' : 'Publish'}</Button>
            <Button variant="secondary" onClick={() => void save('DRAFT')} disabled={busy}>{saving === 'DRAFT' ? 'Saving…' : 'Save draft'}</Button>
          </>
        )}
      </div>
    </form>
  );
}
