import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Map as MapIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Comments } from '@/features/blog/comments';
import { formatDate, formatDateOnly, paragraphs, plural } from '@/features/blog/format';
import { LikeButton } from '@/features/blog/like-button';
import { OwnerActions } from '@/features/blog/owner-actions';
import { LoadFailed } from '@/features/blog/page-states';
import { AuthorName } from '@/features/blog/post-card';
import { loadPost } from '@/features/blog/server';
import { TagList } from '@/features/blog/tag-list';
import type { PostDetail } from '@/features/blog/types';

// Rendering: dynamic, read with the viewer's cookies and never cached (no ISR). The same URL serves an author
// their own draft or hidden post and carries the viewer's own like; a cached copy could leak those to others,
// and a post hidden by a moderator must disappear on the next request. See docs/m2/BLOG.md.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

const isPublic = (post: PostDetail) => post.status === 'PUBLISHED' && !post.isHidden;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const result = await loadPost(id);
  if (result.kind !== 'ok') return { title: 'Post not found', robots: { index: false } };
  const post = result.data;
  return {
    title: post.title,
    description: post.content.slice(0, 160).replace(/\s+/gu, ' ').trim(),
    // Drafts and hidden posts are only ever seen by their author or an admin: never index them.
    robots: isPublic(post) ? undefined : { index: false, follow: false },
    openGraph: isPublic(post) ? { title: post.title, type: 'article', publishedTime: post.publishedAt, authors: [post.author.name] } : undefined,
  };
}

export default async function PostPage({ params }: Props) {
  const { id } = await params;
  const result = await loadPost(id);
  if (result.kind === 'not-found' || result.kind === 'unauthenticated' || result.kind === 'forbidden') notFound();
  if (result.kind === 'error') return <LoadFailed message={result.message} retryHref={`/blog/${encodeURIComponent(id)}`} />;
  const post = result.data;
  const open = isPublic(post);
  const date = post.publishedAt ?? post.createdAt;

  return (
    <article className="mx-auto grid w-full max-w-3xl gap-8">
      <div><Link href="/blog" className="text-sm">All stories</Link></div>

      <header className="grid gap-4">
        {(post.status === 'DRAFT' || post.isHidden) && (
          <div className="flex flex-wrap gap-2">
            {post.status === 'DRAFT' && <Badge tone="warning">Draft: only you can see it</Badge>}
            {post.isHidden && <Badge tone="danger">Hidden by a moderator: only the author and admins can see it</Badge>}
          </div>
        )}
        <h1 className="m-0 break-words">{post.title}</h1>
        <p className="m-0 text-muted">
          By <AuthorName author={post.author} /> · {post.publishedAt ? 'Published' : 'Created'} <time dateTime={date}>{formatDate(date)}</time>
        </p>
        <TagList tags={post.tags} />
        <OwnerActions postId={post.postId} authorId={post.author.userId} title={post.title} />
      </header>

      {post.images.length > 0 && (
        <ul aria-label="Photos" className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
          {post.images.map((image, index) => (
            <li key={image.imageId} className={`overflow-hidden rounded-card border border-border bg-canvas ${index === 0 && post.images.length % 2 === 1 ? 'sm:col-span-2' : ''}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- served by our own API with the post's visibility, not optimizable */}
              <img src={image.url} alt={`Photo ${index + 1} of ${post.images.length} from “${post.title}”`} className="aspect-[4/3] size-full object-cover" loading={index === 0 ? 'eager' : 'lazy'} />
            </li>
          ))}
        </ul>
      )}

      {/* A narrow reading measure (about 65 characters) for the story text. */}
      <div className="grid max-w-[65ch] gap-4 text-lg leading-relaxed">
        {paragraphs(post.content).map((paragraph, index) => <p key={index} className="m-0 whitespace-pre-line break-words">{paragraph}</p>)}
      </div>

      {post.itinerary && (
        <aside aria-labelledby="attached-itinerary" className="grid gap-2 rounded-card border border-border bg-card p-5">
          <p id="attached-itinerary" className="m-0 inline-flex items-center gap-2 text-sm font-semibold text-muted"><MapIcon size={16} aria-hidden="true" />Attached itinerary</p>
          <h2 className="m-0 text-xl">
            <Link href={`/explore/itineraries/${encodeURIComponent(post.itinerary.itineraryId)}`}>{post.itinerary.title}</Link>
          </h2>
          <p className="m-0 text-sm text-muted">
            {plural(post.itinerary.dayCount, 'day')}
            {post.itinerary.cities.length > 0 && ` · ${post.itinerary.cities.join(', ')}`}
            {' · '}{formatDateOnly(post.itinerary.startDate)}{post.itinerary.endDate && ` to ${formatDateOnly(post.itinerary.endDate)}`}
          </p>
        </aside>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 border-y border-border py-4">
        {open
          ? <LikeButton postId={post.postId} initialLiked={post.likedByMe} initialCount={post.likesCount} />
          : <span className="text-sm text-muted">{plural(post.likesCount, 'like')}. Likes open once the post is published.</span>}
        {/* TODO(after PR #153): mount Arwa's report action here when the viewer is not the author:
            <ReportAction targetType="POST" targetId={post.postId} /> (it sends guests to sign in, ACC-10). */}
      </div>

      <Comments postId={post.postId} initialPage={post.comments} open={open} />
    </article>
  );
}
