import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState } from '@/components/ui/empty-state';
import { authorHref, formatDateOnly, formatMonth, pageParam, plural } from '@/features/blog/format';
import { LoadFailed } from '@/features/blog/page-states';
import { Pager } from '@/features/blog/pager';
import { PostCardList } from '@/features/blog/post-card';
import { loadAuthor } from '@/features/blog/server';

// Rendering: dynamic, server-rendered per request from a public, cookie-free API read that is never cached:
// the backend answers 404 for a deactivated author (ACC-12) and that must apply at once. See docs/m2/BLOG.md.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function read({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const page = pageParam(query.page);
  const itinerariesPage = pageParam(query.itinerariesPage);
  return { id, page, itinerariesPage, result: await loadAuthor(id, page, itinerariesPage) };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { result, page, itinerariesPage } = await read(props);
  if (result.kind !== 'ok') return { title: 'Author not found', robots: { index: false } };
  return {
    title: `${result.data.name}, travel stories`,
    description: `Travel stories and public itineraries by ${result.data.name}.`,
    robots: page > 1 || itinerariesPage > 1 ? { index: false, follow: true } : undefined,
  };
}

export default async function AuthorPage(props: Props) {
  const { id, page, itinerariesPage, result } = await read(props);
  if (result.kind === 'not-found') notFound();
  const here = (posts: number, trips: number) => {
    const query = new URLSearchParams();
    if (posts > 1) query.set('page', String(posts));
    if (trips > 1) query.set('itinerariesPage', String(trips));
    return query.size ? `${authorHref(id)}?${query}` : authorHref(id);
  };
  if (result.kind !== 'ok') return <LoadFailed message={result.kind === 'error' ? result.message : 'This author could not be loaded.'} retryHref={here(page, itinerariesPage)} />;
  const author = result.data;

  return (
    <div className="stack">
      <header>
        <Link href="/blog" className="text-sm">All stories</Link>
        <h1 className="m-0 mt-3 wrap-anywhere">{author.name}</h1>
        <p className="m-0 mt-2 text-muted">Joined <time dateTime={author.joinedAt}>{formatMonth(author.joinedAt)}</time></p>
      </header>

      <section aria-labelledby="author-posts" className="grid min-w-0 gap-4">
        <h2 id="author-posts" className="m-0">Published posts <span className="text-base font-normal text-muted">({author.posts.total})</span></h2>
        {author.posts.items.length === 0
          ? <EmptyState title={author.posts.total === 0 ? 'No published posts yet' : 'This page is empty'} />
          : <PostCardList posts={author.posts.items} headingLevel="h3" />}
        <Pager page={author.posts.page} totalPages={author.posts.totalPages} label="Post pages" href={target => here(target, itinerariesPage)} />
      </section>

      <section aria-labelledby="author-itineraries" className="grid min-w-0 gap-4">
        <h2 id="author-itineraries" className="m-0">Public itineraries <span className="text-base font-normal text-muted">({author.itineraries.total})</span></h2>
        {author.itineraries.items.length === 0 ? (
          <EmptyState title={author.itineraries.total === 0 ? 'No public itineraries yet' : 'This page is empty'} />
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
            {author.itineraries.items.map(itinerary => (
              <li key={itinerary.itineraryId} className="grid min-w-0 gap-1 rounded-card border border-border bg-card p-5">
                <h3 className="m-0 text-lg wrap-anywhere">
                  {/* Kiki's public itinerary page (ITN-21). */}
                  <Link href={`/explore/itineraries/${encodeURIComponent(itinerary.itineraryId)}`}>{itinerary.title}</Link>
                </h3>
                <p className="m-0 text-sm text-muted">
                  {plural(itinerary.dayCount, 'day')}
                  {itinerary.cities.length > 0 && ` · ${itinerary.cities.join(', ')}`}
                  {' · '}{formatDateOnly(itinerary.startDate)}{itinerary.endDate && ` to ${formatDateOnly(itinerary.endDate)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
        <Pager page={author.itineraries.page} totalPages={author.itineraries.totalPages} label="Itinerary pages" href={target => here(page, target)} />
      </section>
    </div>
  );
}
