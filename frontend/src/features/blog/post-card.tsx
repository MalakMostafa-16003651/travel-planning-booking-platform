import Link from 'next/link';
import { Heart, MessageCircle } from 'lucide-react';
import { authorHref, formatDate, plural, postHref } from './format';
import { TagList } from './tag-list';
import type { Author, PostListItem } from './types';

/** ACC-12: a deactivated author has no id and is shown as plain "Deleted user", without a link. */
export function AuthorName({ author }: { author: Author }) {
  if (!author.userId) return <span>{author.name}</span>;
  return <Link href={authorHref(author.userId)}>{author.name}</Link>;
}

export function Counts({ likes, comments }: { likes: number; comments: number }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
      <span className="inline-flex items-center gap-1"><Heart size={16} aria-hidden="true" />{plural(likes, 'like')}</span>
      <span className="inline-flex items-center gap-1"><MessageCircle size={16} aria-hidden="true" />{plural(comments, 'comment')}</span>
    </span>
  );
}

/**
 * One published post in a list (BLG-02, BLG-09): title, author, date and excerpt. List responses carry no
 * images, so the card is text only; post images (4:3) appear on the post page.
 */
export function PostCard({ post, headingLevel = 'h2' }: { post: PostListItem; headingLevel?: 'h2' | 'h3' }) {
  const Heading = headingLevel;
  return (
    <article className="grid min-w-0 gap-3 rounded-card border border-border bg-card p-5 sm:p-6">
      <Heading className="m-0 text-xl wrap-anywhere">
        <Link href={postHref(post.postId)} className="text-ink! no-underline hover:underline">{post.title}</Link>
      </Heading>
      <p className="m-0 text-sm text-muted wrap-anywhere">
        By <AuthorName author={post.author} /> · <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
      </p>
      <p className="m-0 max-w-prose whitespace-pre-line wrap-anywhere">{post.excerpt}</p>
      <TagList tags={post.tags} label={`Tags of ${post.title}`} />
      <Counts likes={post.likesCount} comments={post.commentsCount} />
    </article>
  );
}

export function PostCardList({ posts, headingLevel }: { posts: PostListItem[]; headingLevel?: 'h2' | 'h3' }) {
  return (
    <ul className="m-0 grid list-none gap-4 p-0">
      {posts.map(post => <li key={post.postId} className="min-w-0"><PostCard post={post} headingLevel={headingLevel} /></li>)}
    </ul>
  );
}
