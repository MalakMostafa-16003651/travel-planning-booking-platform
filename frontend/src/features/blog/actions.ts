'use server';

import { updateTag } from 'next/cache';
import { BLOG_CACHE_TAG } from './server';

/**
 * Read-your-own-writes for the cached public lists (/blog, author pages, home stories). Called by the
 * browser after an author creates, publishes, edits or deletes a post, or after a like or comment changes
 * the counts. It only expires shared public data; it reads nothing and changes nothing on the backend.
 */
export async function refreshPublicBlog(): Promise<void> {
  updateTag(BLOG_CACHE_TAG);
}
