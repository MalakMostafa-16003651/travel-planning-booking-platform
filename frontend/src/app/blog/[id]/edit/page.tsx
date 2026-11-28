import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { loginHref } from '@/config/routes';
import { DeletePostButton } from '@/features/blog/delete-post';
import { postHref } from '@/features/blog/format';
import { LoadFailed, NotYourPost, TravelerOnly } from '@/features/blog/page-states';
import { PostEditor } from '@/features/blog/post-editor';
import { loadPost } from '@/features/blog/server';
import { getServerSession } from '@/lib/api/server-session';

// Rendering: dynamic and private, read fresh with the author's cookies (drafts and hidden posts included).
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Edit post', robots: { index: false } };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const notices: Record<string, string> = {
  draft: 'Saved as a draft. Only you can see it. You can now add images.',
  published: 'Published. It now appears on the blog and in search. You can now add images.',
};

export default async function EditPostPage({ params, searchParams }: Props) {
  const { id } = await params;
  const here = `${postHref(id)}/edit`;
  const user = await getServerSession();
  if (!user) redirect(loginHref(here));
  if (user.role !== 'USER') return <TravelerOnly title="You can’t edit this post" />;

  const result = await loadPost(id);
  if (result.kind === 'not-found') notFound();
  if (result.kind === 'unauthenticated') redirect(loginHref(here));
  if (result.kind === 'forbidden') return <NotYourPost postId={id} />;
  if (result.kind === 'error') return <LoadFailed message={result.message} retryHref={here} />;
  const post = result.data;
  // The backend refuses edits by anyone else with 403; say so before showing a form that cannot be saved.
  if (post.author.userId !== user.userId) return <NotYourPost postId={id} />;

  const saved = (await searchParams).saved;
  const notice = typeof saved === 'string' ? notices[saved] : undefined;

  return (
    <div className="stack">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/blog/mine" className="text-sm">Your posts</Link>
          <h1 className="m-0 mt-3">Edit post</h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href={postHref(post.postId)} className="inline-flex min-h-11 items-center">View post</Link>
          <DeletePostButton postId={post.postId} title={post.title} />
        </div>
      </header>
      <PostEditor userId={user.userId} post={post} notice={notice} />
    </div>
  );
}
