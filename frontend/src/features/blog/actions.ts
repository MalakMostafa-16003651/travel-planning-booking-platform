'use server';

import { updateTag } from 'next/cache';
import { getServerSession } from '@/lib/api/server-session';
import { BLOG_CACHE_TAG } from './server';

/**
 * Expires the cached public post lists (/blog without a keyword, tag pages and the home story previews),
 * so the next read is fresh. Author and post pages are never cached, so they need no refresh.
 *
 * Called by the browser after a blog change: an author creating, publishing, editing or deleting a post,
 * or a like or comment changing the counts. Other owners call it too after a moderator hides or deletes a
 * post (GEN-10) and before an account deactivates (ACC-12); without the call, the 60-second cache is the
 * fallback. It only expires shared public data and reads or changes nothing on the backend. Signed-in
 * accounts only, so anonymous visitors cannot keep emptying the cache. Returns whether it ran.
 */
export async function refreshPublicBlog(): Promise<boolean> {
  let user = null;
  try {
    user = await getServerSession();
  } catch {
    return false;
  }
  if (!user) return false;
  updateTag(BLOG_CACHE_TAG);
  return true;
}
