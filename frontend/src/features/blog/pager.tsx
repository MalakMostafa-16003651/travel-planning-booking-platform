import Link from 'next/link';
import { buttonClassName } from '@/components/ui/button';
import { linkButtonClass } from './format';

// TODO(after PR #152): replace with Arwa's shared Pagination from '@/components/data-table'.
// This tiny pager only links to the server's own pages of ten (GEN-05); it never slices a page itself.

type PagerProps = {
  page: number;
  totalPages: number;
  label: string;
} & ({ href: (page: number) => string; onPage?: never } | { onPage: (page: number) => void; href?: never; disabled?: boolean });

/** Previous/Next with "Page X of Y". Links for server pages; buttons when a client list loads its own pages. */
export function Pager(props: PagerProps) {
  const { page, totalPages, label } = props;
  if (totalPages <= 1) return null;
  const previous = page > 1 ? page - 1 : null;
  const next = page < totalPages ? page + 1 : null;

  const control = (target: number | null, text: string, rel: 'prev' | 'next') => {
    if (target === null) {
      return <span aria-disabled="true" className={buttonClassName('secondary', 'pointer-events-none opacity-50')}>{text}</span>;
    }
    if (props.href) return <Link href={props.href(target)} rel={rel} className={linkButtonClass('secondary')}>{text}</Link>;
    return <button type="button" disabled={props.disabled} onClick={() => props.onPage(target)} className={buttonClassName('secondary')}>{text}</button>;
  };

  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3">
      {control(previous, 'Previous', 'prev')}
      <p className="m-0 text-sm text-muted" aria-live="polite">Page {Math.min(page, totalPages)} of {totalPages}</p>
      {control(next, 'Next', 'next')}
    </nav>
  );
}
