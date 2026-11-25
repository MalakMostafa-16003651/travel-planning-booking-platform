import type { ReactNode } from 'react';

export interface DataTableColumn<Row> {
  /** Stable key for the column. */
  id: string;
  header: ReactNode;
  /** What this column shows for one row. */
  cell: (row: Row) => ReactNode;
  /** Numbers and amounts read best aligned to the end. */
  align?: 'start' | 'end';
  /** Marks the column that names the row (usually the first); screen readers announce it as the row header. */
  rowHeader?: boolean;
  /** Let long text (descriptions, reasons) wrap. Other cells stay on one line and the frame scrolls sideways on small screens. */
  wrap?: boolean;
}

export interface DataTableProps<Row> {
  /** Accessible name for the table, for example "Accounts". */
  caption: string;
  /** Show the caption on screen as well. Hidden by default because the page heading usually says the same. */
  showCaption?: boolean;
  columns: DataTableColumn<Row>[];
  /** Exactly the items of the current server page. Never slice one API page to fake more pages. */
  rows: Row[];
  rowKey: (row: Row) => string;
  /** Shown instead of the table when there are no rows, for example an EmptyState. */
  empty?: ReactNode;
}

/**
 * GEN-05 shared table. Presentation only: the consumer loads one server page and passes its items,
 * then renders <Pagination> below it. Wide tables scroll sideways inside their own frame, so the page
 * itself never scrolls sideways on a phone.
 */
export function DataTable<Row>({ caption, showCaption = false, columns, rows, rowKey, empty }: DataTableProps<Row>) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  const alignClass = (align?: 'start' | 'end') => (align === 'end' ? 'text-right' : 'text-left');
  const wrapClass = (wrap?: boolean) => (wrap ? 'min-w-48 max-w-md' : 'whitespace-nowrap');

  return (
    <div className="max-w-full overflow-x-auto rounded-card border border-border bg-card" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full border-collapse text-sm">
        <caption className={showCaption ? 'px-4 pt-4 text-left font-heading font-bold text-ink' : 'sr-only'}>{caption}</caption>
        <thead>
          <tr className="border-b border-border bg-canvas">
            {columns.map(column => (
              <th key={column.id} scope="col" className={`whitespace-nowrap px-4 py-3 font-semibold text-ink ${alignClass(column.align)}`}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={rowKey(row)} className="border-b border-border last:border-b-0">
              {columns.map(column =>
                column.rowHeader ? (
                  <th key={column.id} scope="row" className={`px-4 py-3 align-top font-semibold text-ink ${wrapClass(column.wrap)} ${alignClass(column.align)}`}>
                    {column.cell(row)}
                  </th>
                ) : (
                  <td key={column.id} className={`px-4 py-3 align-top text-body ${wrapClass(column.wrap)} ${alignClass(column.align)}`}>
                    {column.cell(row)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
