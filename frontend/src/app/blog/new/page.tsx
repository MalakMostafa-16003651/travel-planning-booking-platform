import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { loginHref } from '@/config/routes';
import { TravelerOnly } from '@/features/blog/page-states';
import { PostEditor } from '@/features/blog/post-editor';
import { getServerSession } from '@/lib/api/server-session';

// Rendering: dynamic and private. The session is checked on the server, so a guest goes straight to
// sign in and comes back here (ACC-10) without seeing an empty editor first.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Write a post', robots: { index: false } };

export default async function NewPostPage() {
  const user = await getServerSession();
  if (!user) redirect(loginHref('/blog/new'));
  if (user.role !== 'USER') return <TravelerOnly />;

  return (
    <div className="stack">
      <header>
        <Link href="/blog/mine" className="text-sm">Your posts</Link>
        <h1 className="m-0 mt-3">Write a post</h1>
        <p className="m-0 mt-2 text-muted">Save it as a draft that only you can see, or publish it to the blog and search.</p>
      </header>
      <PostEditor />
    </div>
  );
}
