import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { authCookies, backendUrl } from '@/lib/api/upstream';
import type { AuthorProfile, MyPostItem, Page, PostDetail, PostListItem } from './types';

const TIMEOUT_MS = 15_000;

/** Public lists are cached for at most this long and tagged so an author's own change can expire them at once. */
export const PUBLIC_REVALIDATE_SECONDS = 60;
export const BLOG_CACHE_TAG = 'blog-public';

export type Loaded<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'unauthenticated' }
  | { kind: 'forbidden' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

async function settle<T>(request: Promise<Response>): Promise<Loaded<T>> {
  let response: Response;
  try {
    response = await request;
  } catch {
    return { kind: 'error', message: 'The blog service is not responding. Please try again.' };
  }
  if (response.status === 401) return { kind: 'unauthenticated' };
  if (response.status === 403) return { kind: 'forbidden' };
  // An invalid id is a 400 from the backend; for a reader it is simply a page that does not exist.
  if (response.status === 404 || response.status === 400) return { kind: 'not-found' };
  if (!response.ok) return { kind: 'error', message: 'The blog could not be loaded. Please try again.' };
  return { kind: 'ok', data: await response.json() as T };
}

/**
 * Public reads send NO cookies, so the cached response is the same for everyone and can never hold a draft,
 * a hidden post or the viewer's like. Hidden or deactivated content leaves the cache within 60 seconds.
 */
function publicGet<T>(path: string): Promise<Loaded<T>> {
  return settle<T>(fetch(new URL(`/api${path}`, backendUrl()), {
    next: { revalidate: PUBLIC_REVALIDATE_SECONDS, tags: [BLOG_CACHE_TAG] },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }));
}

/** Public but must reflect visibility changes at once (a deactivated author's page is 404 immediately, ACC-12). */
function freshPublicGet<T>(path: string): Promise<Loaded<T>> {
  return settle<T>(fetch(new URL(`/api${path}`, backendUrl()), { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) }));
}

/** Viewer-specific reads: the viewer's own cookies, never cached and never shared between requests. */
async function privateGet<T>(path: string): Promise<Loaded<T>> {
  const jar = await cookies();
  return settle<T>(fetch(new URL(`/api${path}`, backendUrl()), {
    headers: { Cookie: authCookies(jar.toString()) },
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }));
}

/** BLG-02 browse (newest first) and BLG-09 search (the backend orders by likes + comments, newest on ties). */
export function loadPublicPosts({ q, tag, page }: { q?: string; tag?: string; page: number }): Promise<Loaded<Page<PostListItem>>> {
  const query = new URLSearchParams({ page: String(page) });
  if (q) query.set('q', q);
  if (tag) query.set('tag', tag);
  return publicGet(`/posts?${query}`);
}

/**
 * BLG-12: public author page; each list has its own page number. Not cached: the page is about one person,
 * and when that person deactivates their account (ACC-12) it must disappear on the next request.
 */
export const loadAuthor = cache((userId: string, page: number, itinerariesPage: number): Promise<Loaded<AuthorProfile>> => {
  const query = new URLSearchParams({ page: String(page), itinerariesPage: String(itinerariesPage) });
  return freshPublicGet(`/authors/${encodeURIComponent(userId)}?${query}`);
});

/**
 * BLG-02 post page. Read fresh with the viewer's cookies: the author sees their own draft or hidden post,
 * likedByMe is personal, and a post that was just hidden disappears immediately. `cache` lets
 * generateMetadata and the page share one request.
 */
export const loadPost = cache((postId: string): Promise<Loaded<PostDetail>> => privateGet(`/posts/${encodeURIComponent(postId)}`));

/** BLG-03: my posts, drafts included. */
export function loadMyPosts(page: number): Promise<Loaded<Page<MyPostItem>>> {
  return privateGet(`/posts/mine?page=${page}`);
}
