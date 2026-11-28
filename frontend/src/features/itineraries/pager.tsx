import Link from 'next/link';

/**
 * GEN-05 server pagination (page size 10). Pages come from the API's own `page`/`totalPages`;
 * nothing is sliced client-side. Swap for Arwa's shared Pagination when it lands on develop.
 */
export function Pager({ page, totalPages, hrefFor, label }: { page: number; totalPages: number; hrefFor: (page: number) => string; label: string }) {
  if (totalPages <= 1) return null;
  const linkClass = 'inline-flex min-h-11 items-center rounded-control border border-border bg-card px-4 text-sm font-semibold no-underline hover:bg-canvas';
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3">
      {page > 1 ? <Link className={linkClass} href={hrefFor(page - 1)} rel="prev">Previous</Link> : <span />}
      <p className="m-0 text-sm text-muted" aria-current="page">Page {page} of {totalPages}</p>
      {page < totalPages ? <Link className={linkClass} href={hrefFor(page + 1)} rel="next">Next</Link> : <span />}
    </nav>
  );
}
