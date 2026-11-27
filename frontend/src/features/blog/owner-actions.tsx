'use client';

import Link from 'next/link';
import { useSession } from '@/features/auth/session-provider';
import { ReportAction } from '@/features/reports';
import { DeletePostButton } from './delete-post';
import { linkButtonClass, postHref } from './format';

/** BLG-04: the author sees Edit and Delete on their own post. The backend still checks ownership. */
export function OwnerActions({ postId, authorId, title }: { postId: string; authorId: string | null; title: string }) {
  const { user } = useSession();
  if (!user || !authorId || user.userId !== authorId) return null;
  return (
    <div className="flex flex-wrap gap-3">
      <Link href={`${postHref(postId)}/edit`} className={linkButtonClass('secondary')}>Edit post</Link>
      <DeletePostButton postId={postId} title={title} />
    </div>
  );
}

/** GEN-09: everyone except the author can report a public post (guests are sent to sign in, ACC-10). */
export function ReportPost({ postId, authorId }: { postId: string; authorId: string | null }) {
  const { user } = useSession();
  if (user && authorId && user.userId === authorId) return null;
  return <ReportAction targetType="POST" targetId={postId} />;
}
