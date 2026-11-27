import Link from 'next/link';
import { buttonClassName } from '@/components/ui/button';

interface PaginationBase {
  /** Current page, from 1. Use the page the server answered with. */
  page: number;
  /** From pageCount(result): the endpoint's totalPages, or total / pageSize. */
  totalPages: number;
  /** Total number of items across all pages, from the server. Shows "Showing 11–20 of 57". */
  total?: number;
  /** Items per page from the server (10 for GEN-05). Needed with total for the "Showing" line. */
  pageSize?: number;
  /** Accessible name, for example "Accounts pages". */
  label?: string;
}

/** Server-rendered lists: every page is its own URL (use pageHref to keep the filters). */
interface LinkPagination extends PaginationBase {
  hrefForPage: (page: number) => string;
  onPageChange?: never;
  disabled?: never;
}

/** Client lists that load the next page themselves. Disable while a page is loading. */
interface CallbackPagination extends PaginationBase {
  onPageChange: (page: number) => void;
  disabled?: boolean;
  hrefForPage?: never;
}

export type PaginationProps = LinkPagination | CallbackPagination;

/**
 * GEN-05 shared page controls: Previous, "Page 2 of 6" and Next. Renders nothing when everything fits
 * on one page, apart from the count line when total is given.
 */
export function Pagination(props: PaginationProps) {
  const { page, totalPages, total, pageSize, label = 'Pages' } = props;
  const pages = Math.max(1, totalPages);
  const summary = total !== undefined && pageSize ? showing(page, pageSize, total) : null;

  if (pages <= 1) return summary ? <p className="m-0 text-sm text-muted">{summary}</p> : null;

  const control = (target: number, text: string, rel: 'prev' | 'next') => {
    const unavailable = target < 1 || target > pages;
    const className = buttonClassName('secondary');
    if (props.hrefForPage) {
      return unavailable
        ? <span aria-disabled="true" className={`${className} pointer-events-none opacity-60`}>{text}</span>
        : <Link href={props.hrefForPage(target)} rel={rel} className={className}>{text}</Link>;
    }
    return (
      <button type="button" className={className} disabled={unavailable || props.disabled} onClick={() => props.onPageChange(target)}>
        {text}
      </button>
    );
  };

  return (
    <nav aria-label={label} className="grid gap-3">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
        {control(page - 1, 'Previous', 'prev')}
        <span className="text-center text-sm text-muted">Page {page} of {pages}</span>
        {control(page + 1, 'Next', 'next')}
      </div>
      {summary && <p className="m-0 text-center text-sm text-muted">{summary}</p>}
    </nav>
  );
}

function showing(page: number, pageSize: number, total: number): string {
  if (total === 0) return 'No results';
  const first = (page - 1) * pageSize + 1;
  if (first > total) return `${total} in total`;
  const last = Math.min(total, page * pageSize);
  return `Showing ${first}–${last} of ${total}`;
}
