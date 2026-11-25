'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Heart } from 'lucide-react';
import { buttonClassName } from '@/components/ui/button';
import { loginHref } from '@/config/routes';
import { useSession } from '@/features/auth/session-provider';
import { ApiError, apiClient } from '@/lib/api/client';
import { refreshPublicBlog } from './actions';
import { plural, postHref } from './format';
import type { LikeState } from './types';

/**
 * BLG-06: like once, remove the like. The count always comes from the server's answer. Guests are sent to
 * sign in and back to this post (ACC-10); only traveler accounts (role USER) may like.
 */
export function LikeButton({ postId, initialLiked, initialCount }: { postId: string; initialLiked: boolean; initialCount: number }) {
  const { user, loading } = useSession();
  const [state, setState] = useState<LikeState>({ liked: initialLiked, likesCount: initialCount });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const count = <span className="text-sm text-muted" aria-live="polite">{plural(state.likesCount, 'like')}</span>;

  if (!loading && !user) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Link href={loginHref(postHref(postId))} className={buttonClassName('secondary', 'text-ink!')}>
          <Heart size={18} aria-hidden="true" />Sign in to like
        </Link>
        {count}
      </div>
    );
  }
  if (user && user.role !== 'USER') {
    return <div className="flex flex-wrap items-center gap-3">{count}<span className="text-sm text-muted">Only traveler accounts can like posts.</span></div>;
  }

  async function toggle() {
    setPending(true);
    setError('');
    try {
      const next = await apiClient<LikeState>(`/posts/${encodeURIComponent(postId)}/like`, { method: state.liked ? 'DELETE' : 'POST' });
      setState(next);
      void refreshPublicBlog();
    } catch (cause) {
      // 409: already liked in another tab. 404 on DELETE: the like was already removed. Show the real state.
      if (cause instanceof ApiError && cause.status === 409) setState(current => ({ ...current, liked: true }));
      else if (cause instanceof ApiError && cause.status === 404 && state.liked) setState(current => ({ ...current, liked: false }));
      else setError(cause instanceof Error ? cause.message : 'Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={loading || pending}
          aria-pressed={state.liked}
          className={buttonClassName(state.liked ? 'primary' : 'secondary')}
        >
          <Heart size={18} aria-hidden="true" fill={state.liked ? 'currentColor' : 'none'} />
          {state.liked ? 'Liked' : 'Like'}
        </button>
        {count}
      </div>
      {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
    </div>
  );
}
