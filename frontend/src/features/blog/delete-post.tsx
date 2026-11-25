'use client';

import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ApiError, apiClient } from '@/lib/api/client';
import { refreshPublicBlog } from './actions';

/** BLG-04 with GEN-03: deleting a post asks first, and also removes its comments, likes and images. */
export function DeletePostButton({ postId, title, afterDelete = 'mine' }: { postId: string; title: string; afterDelete?: 'mine' | 'refresh' }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      triggerLabel="Delete post"
      title="Delete this post?"
      description={<>“{title}” and all of its comments, likes and images will be deleted. This cannot be undone.</>}
      confirmLabel="Delete post"
      pendingLabel="Deleting…"
      onConfirm={async () => {
        try {
          await apiClient<void>(`/posts/${encodeURIComponent(postId)}`, { method: 'DELETE' });
        } catch (cause) {
          // Already gone (another tab): the goal is reached, so carry on to the list.
          if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
        }
        await refreshPublicBlog();
        if (afterDelete === 'mine') router.push('/blog/mine?deleted=1');
        else router.refresh();
      }}
    />
  );
}
