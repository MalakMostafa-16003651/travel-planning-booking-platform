import { buttonClassName, type ButtonVariant } from '@/components/ui/button';

// Formatted in UTC on purpose: the same text is produced on the server and in the browser, so the
// date never changes during hydration. Blog dates are informative, not travel times.
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function formatDate(iso: string | undefined): string {
  return iso ? dateFormat.format(new Date(iso)) : '';
}

export function formatMonth(iso: string): string {
  return monthFormat.format(new Date(iso));
}

/** Itinerary dates are date-only (YYYY-MM-DD): read them as UTC so no time zone shifts the day. */
export function formatDateOnly(value: string): string {
  return dateFormat.format(new Date(`${value}T00:00:00Z`));
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export const postHref = (postId: string) => `/blog/${encodeURIComponent(postId)}`;
export const authorHref = (userId: string) => `/authors/${encodeURIComponent(userId)}`;

/** The /blog URL keeps the keyword, tag and page, so a search can be shared and survives reload. */
export function blogHref({ q, tag, page }: { q?: string; tag?: string; page?: number } = {}): string {
  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (tag) query.set('tag', tag);
  if (page && page > 1) query.set('page', String(page));
  return query.size ? `/blog?${query}` : '/blog';
}

/** A positive whole page number from the URL, else 1. */
export function pageParam(value: string | string[] | undefined): number {
  const number = Number(Array.isArray(value) ? value[0] : value);
  return Number.isSafeInteger(number) && number > 0 ? number : 1;
}

export function textParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

/**
 * Classes for a Next <Link> styled as the shared Button. globals.css colours every <a> outside
 * Tailwind's layers, so the text colour is marked important (same approach as flight bookings).
 */
export function linkButtonClass(variant: ButtonVariant = 'primary'): string {
  return buttonClassName(variant, variant === 'secondary' ? 'text-ink!' : 'text-white!');
}

/** Turns plain text into paragraphs: blank lines split paragraphs, single newlines stay as line breaks. */
export function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/u).map(part => part.trim()).filter(Boolean);
}
