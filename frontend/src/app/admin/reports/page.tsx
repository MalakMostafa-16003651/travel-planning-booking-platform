import type { Metadata } from 'next';
import Link from 'next/link';
import { DataTable, FilterSelect, Pagination, TableFilters, enumParam, pageCount, pageHref, readPage, type DataTableColumn, type SearchParams } from '@/components/data-table';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { buttonClassName } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/error-alert';
import { AdminNav } from '@/features/admin/admin-nav';
import { REPORT_STATUSES, TARGET_TYPES, reportStatusLabels, targetTypeLabels, type AdminReport, type ReportStatus } from '@/features/admin/moderation-types';
import { AdminAccessDenied, AdminLoadFailed } from '@/features/admin/page-states';
import { ReportActions } from '@/features/admin/report-actions';
import { loadReports, requireAdmin } from '@/features/admin/server';

// Rendering: dynamic SSR. Admin-only data, read fresh on every request and never cached.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Reports', robots: { index: false } };

const PATH = '/admin/reports';
const statusTones: Record<ReportStatus, BadgeTone> = { OPEN: 'warning', RESOLVING: 'info', DISMISSED: 'neutral', CONTENT_HIDDEN: 'success', CONTENT_DELETED: 'danger' };
const reported = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const columns: DataTableColumn<AdminReport>[] = [
  { id: 'created', header: 'Reported', cell: report => reported.format(new Date(report.createdAt)) },
  {
    id: 'content', header: 'Content', rowHeader: true, cell: report => (
      <div className="grid gap-1 font-normal">
        <span className="font-semibold">{targetTypeLabels[report.targetType]}</span>
        <code className="text-xs text-muted">{report.targetId}</code>
      </div>
    ),
  },
  { id: 'reason', header: 'Reason', wrap: true, cell: report => report.reason },
  { id: 'reporter', header: 'Reported by', cell: report => report.userName ?? 'Unknown user' },
  { id: 'status', header: 'Status', cell: report => <Badge tone={statusTones[report.status]}>{reportStatusLabels[report.status] ?? report.status}</Badge> },
  {
    id: 'actions', header: 'Actions', cell: report => (
      <div className="grid justify-items-start gap-2">
        <ReportActions report={report} />
        <Link href={`/admin/content?type=${report.targetType.toLowerCase()}&id=${report.targetId}`} className="text-sm">Moderate directly</Link>
      </div>
    ),
  },
];

export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const returnTo = pageHref(PATH, params, readPage(params));
  if (!(await requireAdmin(returnTo))) return <AdminAccessDenied />;

  const filters = {
    page: readPage(params),
    status: enumParam(params, 'status', REPORT_STATUSES),
    targetType: enumParam(params, 'targetType', TARGET_TYPES),
  };
  const result = await loadReports(filters, returnTo);
  if (result.kind === 'forbidden') return <AdminAccessDenied />;
  const statusLabel = reportStatusLabels[filters.status ?? 'OPEN'].toLowerCase();

  return (
    <div className="page-container page-content stack content-start">
      <div>
        <p className="eyebrow">Administration</p>
        <h1 className="m-0">Reports</h1>
        <p className="muted mb-0">What travelers reported, newest first. Open reports are shown unless you choose another status.</p>
      </div>
      <AdminNav current={PATH} />

      <TableFilters action={PATH} label="Filter reports">
        <FilterSelect name="status" label="Status" value={filters.status} anyLabel="Open" options={REPORT_STATUSES.filter(status => status !== 'OPEN').map(status => ({ value: status, label: reportStatusLabels[status] }))} />
        <FilterSelect name="targetType" label="Content type" value={filters.targetType} anyLabel="All types" options={TARGET_TYPES.map(type => ({ value: type, label: targetTypeLabels[type] }))} />
      </TableFilters>

      {result.kind === 'invalid' && <ErrorAlert title="Check the filters" message={result.message} />}
      {result.kind === 'error' && <AdminLoadFailed message={result.message} retryHref={returnTo} />}
      {result.kind === 'ok' && (
        result.data.total > 0 && result.data.items.length === 0 ? (
          <EmptyState title="This page is empty" description="There are fewer reports than this page number." action={<Link href={pageHref(PATH, params, 1)} className={buttonClassName('secondary')}>Go to the first page</Link>} />
        ) : (
          <div className="grid gap-4">
            <DataTable
              caption="Reports"
              columns={columns}
              rows={result.data.items}
              rowKey={report => report.reportId}
              empty={<EmptyState title={`No ${statusLabel} reports`} description={filters.status ? 'Try another status or content type.' : 'Nothing is waiting for review.'} />}
            />
            <Pagination label="Report pages" page={result.data.page} totalPages={pageCount(result.data)} total={result.data.total} pageSize={result.data.pageSize} hrefForPage={page => pageHref(PATH, params, page)} />
          </div>
        )
      )}
    </div>
  );
}
