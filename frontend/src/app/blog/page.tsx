import type { Metadata } from 'next';
import Link from 'next/link';
import { X } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { blogHref, linkButtonClass, pageParam, plural, textParam } from '@/features/blog/format';
import { LoadFailed } from '@/features/blog/page-states';
import { Pager } from '@/features/blog/pager';
import { PostCardList } from '@/features/blog/post-card';
import { SearchForm } from '@/features/blog/search-form';
import { loadPublicPosts } from '@/features/blog/server';
import { BLOG_LIMITS } from '@/features/blog/types';

// Rendering: server-rendered per request (the keyword, tag and page are in the URL). The API read itself is
// public and cookie-free, cached for 60 seconds and expired at once by an author's own change. See docs/m2/BLOG.md.

type Query = Record<string, string | string[] | undefined>;
type Props = { searchParams: Promise<Query> };

function criteria(query: Query) {
  return {
    q: textParam(query.q).slice(0, BLOG_LIMITS.searchMax),
    tag: textParam(query.tag).toLowerCase().slice(0, BLOG_LIMITS.tagMax),
    page: pageParam(query.page),
  };
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q, tag, page } = criteria(await searchParams);
  const filtered = Boolean(q || tag || page > 1);
  return {
    title: q ? `Search: ${q}` : tag ? `Stories tagged ${tag}` : 'Travel stories',
    description: 'Travel stories, tips and itineraries published by travelers.',
    // Only the plain list is indexed; search and filter pages are endless variations of it.
    robots: filtered ? { index: false, follow: true } : undefined,
    alternates: { canonical: '/blog' },
  };
}

export default async function BlogPage({ searchParams }: Props) {
  const { q, tag, page } = criteria(await searchParams);
  const result = await loadPublicPosts({ q, tag, page });
  const here = blogHref({ q, tag, page });

  return (
    <div className="stack">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Community</p>
          <h1 className="m-0">Travel stories</h1>
        </div>
        <Link href="/blog/new" className={linkButtonClass('primary')}>Write a post</Link>
      </header>

      <div className="grid gap-3">
        <SearchForm q={q} tag={tag} />
        {(tag || q) && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {tag && (
              <Link href={blogHref({ q })} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-primary bg-primary/10 px-3 font-semibold text-ink! no-underline">
                Tag: #{tag}<X size={14} aria-hidden="true" /><span className="sr-only">, remove this filter</span>
              </Link>
            )}
            {q && <Link href={blogHref({ tag })}>Clear search</Link>}
          </div>
        )}
      </div>

      {result.kind === 'ok' ? (
        <section aria-labelledby="blog-results" className="grid min-w-0 gap-4">
          <h2 id="blog-results" className="m-0 text-lg wrap-anywhere">
            {q ? `${plural(result.data.total, 'result')} for “${q}”` : plural(result.data.total, 'post')}
            {q && <span className="block text-sm font-normal tracking-normal text-muted">Most liked and discussed first, newest first on ties.</span>}
          </h2>
          {result.data.total === 0 ? (
            <EmptyState
              title={q || tag ? 'No results' : 'No stories yet'}
              description={q || tag ? 'No published post matches. Try another keyword or tag.' : 'Be the first to share a trip.'}
              action={q || tag ? <Link href="/blog" className={linkButtonClass('secondary')}>Show all stories</Link> : <Link href="/blog/new" className={linkButtonClass('primary')}>Write a post</Link>}
            />
          ) : result.data.items.length === 0 ? (
            <EmptyState title="This page is empty" description="There are fewer posts than before." action={<Link href={blogHref({ q, tag })} className={linkButtonClass('secondary')}>Go to the first page</Link>} />
          ) : (
            <PostCardList posts={result.data.items} />
          )}
          <Pager page={result.data.page} totalPages={result.data.totalPages} label="Story pages" href={target => blogHref({ q, tag, page: target })} />
        </section>
      ) : result.kind === 'not-found' ? (
        <EmptyState title="No results" description="That search could not be run. Try a shorter keyword or another tag." action={<Link href="/blog" className={linkButtonClass('secondary')}>Show all stories</Link>} />
      ) : (
        <LoadFailed message={result.kind === 'error' ? result.message : 'The blog could not be loaded.'} retryHref={here} />
      )}
    </div>
  );
}
