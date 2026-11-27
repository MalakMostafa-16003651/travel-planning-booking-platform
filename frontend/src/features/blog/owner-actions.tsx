'use client';

import Link from 'next/link';
import { useSession } from '@/features/auth/session-provider';
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
