import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { blogHref, formatDate, linkButtonClass, postHref } from './format';
import { Counts } from './post-card';
import { loadPublicPosts } from './server';

/**
 * Home "Travel stories" slot for Malak's HomeContent: the newest published posts as small cards.
 * Server Component. It reads the same public, cookie-free, 60-second cached list as /blog, so it never
 * shows drafts, hidden posts or anything personal. Usage: <HomeContent stories={<BlogStoryPreviews />} />.
 */
export async function BlogStoryPreviews({ limit = 3 }: { limit?: number }) {
  const result = await loadPublicPosts({ page: 1 });
  const action = <Link href={blogHref()} className={linkButtonClass('secondary')}>Read all stories</Link>;
  if (result.kind !== 'ok') return <EmptyState title="Stories are unavailable right now" description="Please try again later." action={action} />;
  const posts = result.data.items.slice(0, Math.min(Math.max(1, limit), result.data.pageSize));
  if (posts.length === 0) return <EmptyState title="No stories yet" description="Travelers' stories will appear here once they are published." action={action} />;

  return (
    <div className="grid gap-4">
      <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
        {posts.map(post => (
          <li key={post.postId} className="grid content-start gap-2 rounded-card border border-border bg-card p-5">
            <h3 className="m-0 text-lg"><Link href={postHref(post.postId)} className="text-ink! no-underline hover:underline">{post.title}</Link></h3>
            <p className="m-0 text-sm text-muted">{post.author.name} · <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time></p>
            <p className="m-0 line-clamp-3 text-sm">{post.excerpt}</p>
            <Counts likes={post.likesCount} comments={post.commentsCount} />
          </li>
        ))}
      </ul>
      <div>{action}</div>
    </div>
  );
}
