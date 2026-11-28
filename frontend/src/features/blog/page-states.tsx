import Link from 'next/link';
import { ErrorAlert } from '@/components/ui/error-alert';
import { linkButtonClass } from './format';

/** Writing is for traveler accounts (backend @Roles(USER)); admins and moderators get this instead of a 403. */
export function TravelerOnly({ title = 'Access denied' }: { title?: string }) {
  return (
    <section className="stack" aria-labelledby="blog-access-denied">
      <h1 id="blog-access-denied" className="m-0">{title}</h1>
      <p className="m-0">Only traveler accounts can write blog posts. Sign in with a traveler account to continue.</p>
      <div><Link href="/blog" className={linkButtonClass('secondary')}>Back to the blog</Link></div>
    </section>
  );
}

/** Another user's post: the backend answers 403 on edit, shown here as a clear page instead of a broken form. */
export function NotYourPost({ postId }: { postId: string }) {
  return (
    <section className="stack" aria-labelledby="not-your-post">
      <h1 id="not-your-post" className="m-0">You can’t edit this post</h1>
      <p className="m-0">Only its author can edit or delete a post.</p>
      <div><Link href={`/blog/${encodeURIComponent(postId)}`} className={linkButtonClass('secondary')}>Back to the post</Link></div>
    </section>
  );
}

export function LoadFailed({ message, retryHref }: { message: string; retryHref: string }) {
  return (
    <section className="stack">
      <ErrorAlert title="This page could not be loaded" message={message} />
      {/* A full load, so the failed response is not reused from the router cache. */}
      <div><a href={retryHref}>Try again</a></div>
    </section>
  );
}
