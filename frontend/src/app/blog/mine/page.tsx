import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { loginHref } from '@/config/routes';
import { DeletePostButton } from '@/features/blog/delete-post';
import { FlashNotice } from '@/features/blog/flash-notice';
import { formatDate, linkButtonClass, pageParam, postHref } from '@/features/blog/format';
import { LoadFailed, TravelerOnly } from '@/features/blog/page-states';
import { Pager } from '@/features/blog/pager';
import { Counts } from '@/features/blog/post-card';
import { loadMyPosts } from '@/features/blog/server';
import type { MyPostItem } from '@/features/blog/types';

// Rendering: dynamic and private (drafts included), read with the author's cookies and never cached.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Your posts', robots: { index: false } };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const mineHref = (page: number) => (page > 1 ? `/blog/mine?page=${page}` : '/blog/mine');

function StatusBadges({ post }: { post: MyPostItem }) {
  return (
    <span className="flex flex-wrap gap-2">
      {post.status === 'PUBLISHED' ? <Badge tone="success">Published</Badge> : <Badge tone="warning">Draft</Badge>}
      {post.isHidden && <Badge tone="danger">Hidden by a moderator</Badge>}
    </span>
  );
}

export default async function MyPostsPage({ searchParams }: Props) {
  const query = await searchParams;
  const page = pageParam(query.page);
  const result = await loadMyPosts(page);
  if (result.kind === 'unauthenticated') redirect(loginHref(mineHref(page)));
  if (result.kind === 'forbidden') return <TravelerOnly title="Your posts" />;

  return (
    <div className="stack">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/blog" className="text-sm">All stories</Link>
          <h1 className="m-0 mt-3">Your posts</h1>
        </div>
        <Link href="/blog/new" className={linkButtonClass('primary')}>Write a post</Link>
      </header>
      <FlashNotice param="deleted" message={query.deleted === '1' ? 'The post was deleted.' : null} />

      {result.kind === 'ok' ? (
        result.data.total === 0 ? (
          <EmptyState title="You have no posts yet" description="Drafts and published posts you write appear here." action={<Link href="/blog/new" className={linkButtonClass('primary')}>Write your first post</Link>} />
        ) : result.data.items.length === 0 ? (
          <EmptyState title="This page is empty" description="There are fewer posts than before." action={<Link href="/blog/mine" className={linkButtonClass('secondary')}>Go to the first page</Link>} />
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0" aria-label="Your posts">
            {result.data.items.map(post => (
              <li key={post.postId} className="grid min-w-0 gap-3 rounded-card border border-border bg-card p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="grid min-w-0 gap-2">
                  <StatusBadges post={post} />
                  <h2 className="m-0 text-lg wrap-anywhere"><Link href={postHref(post.postId)} className="text-ink! no-underline hover:underline">{post.title}</Link></h2>
                  <p className="m-0 text-sm text-muted">
                    {post.status === 'PUBLISHED' && post.publishedAt
                      ? <>Published <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time></>
                      : <>Last saved <time dateTime={post.updatedAt}>{formatDate(post.updatedAt)}</time></>}
                  </p>
                  <Counts likes={post.likesCount} comments={post.commentsCount} />
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link href={`${postHref(post.postId)}/edit`} className={linkButtonClass('secondary')}>Edit<span className="sr-only"> {post.title}</span></Link>
                  {/* Deleting the only post on a later page goes back one page instead of showing an empty one. */}
                  <DeletePostButton postId={post.postId} title={post.title} afterDelete={result.data.items.length === 1 && page > 1 ? mineHref(page - 1) as `/${string}` : 'refresh'} />
                </div>
              </li>
            ))}
          </ul>
        )
      ) : (
        <LoadFailed message={result.kind === 'error' ? result.message : 'Your posts could not be loaded.'} retryHref={mineHref(page)} />
      )}
      {result.kind === 'ok' && <Pager page={result.data.page} totalPages={result.data.totalPages} label="Your post pages" href={mineHref} />}
    </div>
  );
}
