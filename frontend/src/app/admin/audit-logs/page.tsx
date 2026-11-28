import type { Metadata } from 'next';
import Link from 'next/link';
import { DataTable, FilterDate, FilterSelect, Pagination, TableFilters, dateParam, enumParam, pageCount, pageHref, readPage, type DataTableColumn, type SearchParams } from '@/components/data-table';
import { buttonClassName } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/error-alert';
import { AdminNav } from '@/features/admin/admin-nav';
import { AdminAccessDenied, AdminLoadFailed } from '@/features/admin/page-states';
import { AUDIT_ACTIONS, AUDIT_TARGETS, auditActionLabels, auditTargetLabels, type AuditEntry } from '@/features/admin/records-types';
import { loadAuditLogs, requireAdmin } from '@/features/admin/server';

// Rendering: dynamic SSR. Admin-only, append-only records from the backend; nothing is created here.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Audit log', robots: { index: false } };

const PATH = '/admin/audit-logs';
const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' });

const columns: DataTableColumn<AuditEntry>[] = [
  { id: 'when', header: 'When', cell: entry => when.format(new Date(entry.createdAt)) },
  { id: 'action', header: 'Action', rowHeader: true, cell: entry => auditActionLabels[entry.action] ?? entry.action },
  { id: 'admin', header: 'Administrator', cell: entry => entry.adminName ?? 'Removed admin account' },
  {
    id: 'target', header: 'Record', cell: entry => (
      <div className="grid gap-1">
        <span className="text-ink">{auditTargetLabels[entry.targetType] ?? entry.targetType}</span>
        <code className="text-xs text-muted">{entry.targetId}</code>
      </div>
    ),
  },
  { id: 'details', header: 'Details', wrap: true, cell: entry => entry.details ?? '' },
];

export default async function AdminAuditLogsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const returnTo = pageHref(PATH, params, readPage(params));
  if (!(await requireAdmin(returnTo))) return <AdminAccessDenied />;

  const filters = {
    page: readPage(params),
    action: enumParam(params, 'action', AUDIT_ACTIONS),
    targetType: enumParam(params, 'targetType', AUDIT_TARGETS),
    from: dateParam(params, 'from'),
    to: dateParam(params, 'to'),
  };
  const filtered = Boolean(filters.action || filters.targetType || filters.from || filters.to);
  const rangeError = filters.from && filters.to && filters.from > filters.to ? 'The "from" date must be on or before the "to" date.' : null;
  const result = rangeError ? null : await loadAuditLogs(filters, returnTo);
  if (result?.kind === 'forbidden') return <AdminAccessDenied />;

  return (
    <div className="page-container page-content stack content-start">
      <div>
        <p className="eyebrow">Administration</p>
        <h1 className="m-0">Audit log</h1>
        <p className="muted mb-0">Every admin action the backend recorded, newest first. Entries cannot be edited or deleted. Times and date filters are in UTC.</p>
      </div>
      <AdminNav current={PATH} />

      <TableFilters action={PATH} label="Filter audit log">
        <FilterSelect name="action" label="Action" value={filters.action} anyLabel="All actions" options={AUDIT_ACTIONS.map(action => ({ value: action, label: auditActionLabels[action] }))} />
        <FilterSelect name="targetType" label="Record type" value={filters.targetType} anyLabel="All records" options={AUDIT_TARGETS.map(target => ({ value: target, label: auditTargetLabels[target] }))} />
        <FilterDate name="from" label="From" value={filters.from} />
        <FilterDate name="to" label="To" value={filters.to} />
      </TableFilters>

      {rangeError && <ErrorAlert title="Check the dates" message={rangeError} />}
      {result?.kind === 'invalid' && <ErrorAlert title="Check the filters" message={result.message} />}
      {result?.kind === 'error' && <AdminLoadFailed message={result.message} retryHref={returnTo} />}
      {result?.kind === 'ok' && (
        result.data.total > 0 && result.data.items.length === 0 ? (
          <EmptyState title="This page is empty" description="There are fewer entries than this page number." action={<Link href={pageHref(PATH, params, 1)} className={buttonClassName('secondary')}>Go to the first page</Link>} />
        ) : (
          <div className="grid gap-4">
            <DataTable
              caption="Audit log"
              columns={columns}
              rows={result.data.items}
              rowKey={entry => entry.auditLogId}
              empty={<EmptyState title={filtered ? 'No entries match these filters' : 'No admin actions recorded yet'} action={filtered ? <Link href={PATH} className={buttonClassName('secondary')}>Clear filters</Link> : undefined} />}
            />
            <Pagination label="Audit log pages" page={result.data.page} totalPages={pageCount(result.data)} total={result.data.total} pageSize={result.data.pageSize} hrefForPage={page => pageHref(PATH, params, page)} />
          </div>
        )
      )}
    </div>
  );
}
