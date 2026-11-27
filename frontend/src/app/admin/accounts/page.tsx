import type { Metadata } from 'next';
import Link from 'next/link';
import { DataTable, FilterSearch, FilterSelect, Pagination, TableFilters, enumParam, firstParam, pageCount, pageHref, readPage, type DataTableColumn, type SearchParams } from '@/components/data-table';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { buttonClassName } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/error-alert';
import { roleLabels } from '@/config/routes';
import { AdminAccessDenied, AdminLoadFailed } from '@/features/admin/page-states';
import { loadAccounts, requireAdmin } from '@/features/admin/server';
import { ACCOUNT_STATUSES, USER_ROLES, type AdminAccount } from '@/features/admin/types';
import type { AccountStatus } from '@/types/auth';

// Rendering: dynamic SSR. Admin-only data, read fresh on every request and never cached.
// Page and filters live in the URL, so every list state can be refreshed, shared and opened directly.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Accounts', robots: { index: false } };

const PATH = '/admin/accounts';

const statusLabels: Record<AccountStatus, string> = { ACTIVE: 'Active', SUSPENDED: 'Suspended', DEACTIVATED: 'Deactivated' };
const statusTones: Record<AccountStatus, BadgeTone> = { ACTIVE: 'success', SUSPENDED: 'warning', DEACTIVATED: 'neutral' };
const registered = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const columns: DataTableColumn<AdminAccount>[] = [
  { id: 'name', header: 'Name', rowHeader: true, cell: account => account.name },
  { id: 'email', header: 'Email', cell: account => account.email },
  { id: 'role', header: 'Role', cell: account => roleLabels[account.role] ?? account.role },
  { id: 'status', header: 'Status', cell: account => <Badge tone={statusTones[account.status]}>{statusLabels[account.status] ?? account.status}</Badge> },
  { id: 'registered', header: 'Registered', cell: account => registered.format(new Date(account.createdAt)) },
];

export default async function AdminAccountsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const returnTo = pageHref(PATH, params, readPage(params));
  if (!(await requireAdmin(returnTo))) return <AdminAccessDenied />;

  const filters = {
    page: readPage(params),
    search: firstParam(params, 'search')?.slice(0, 100),
    role: enumParam(params, 'role', USER_ROLES),
    status: enumParam(params, 'status', ACCOUNT_STATUSES),
  };
  const filtered = Boolean(filters.search || filters.role || filters.status);
  const result = await loadAccounts(filters, returnTo);
  if (result.kind === 'forbidden') return <AdminAccessDenied />;

  return (
    <div className="page-container page-content stack">
      <div>
        <p className="eyebrow">Administration</p>
        <h1 className="m-0">Accounts</h1>
        <p className="muted mb-0">Every registered account, newest first. Search by name or email, or filter by role and status.</p>
      </div>

      <TableFilters action={PATH} label="Filter accounts">
        <FilterSearch label="Name or email" value={filters.search} placeholder="For example nour" />
        <FilterSelect name="role" label="Role" value={filters.role} anyLabel="All roles" options={USER_ROLES.map(role => ({ value: role, label: roleLabels[role] }))} />
        <FilterSelect name="status" label="Status" value={filters.status} anyLabel="All statuses" options={ACCOUNT_STATUSES.map(status => ({ value: status, label: statusLabels[status] }))} />
      </TableFilters>

      {result.kind === 'invalid' && <ErrorAlert title="Check the filters" message={result.message} />}
      {result.kind === 'error' && <AdminLoadFailed message={result.message} retryHref={returnTo} />}
      {result.kind === 'ok' && (
        result.data.total > 0 && result.data.items.length === 0 ? (
          <EmptyState
            title="This page is empty"
            description="There are fewer accounts than this page number."
            action={<Link href={pageHref(PATH, params, 1)} className={buttonClassName('secondary')}>Go to the first page</Link>}
          />
        ) : (
          <div className="grid gap-4">
            <DataTable
              caption="Accounts"
              columns={columns}
              rows={result.data.items}
              rowKey={account => account.userId}
              empty={
                <EmptyState
                  title={filtered ? 'No accounts match these filters' : 'No accounts yet'}
                  description={filtered ? 'Try another name or email, or clear the filters.' : undefined}
                  action={filtered ? <Link href={PATH} className={buttonClassName('secondary')}>Clear filters</Link> : undefined}
                />
              }
            />
            <Pagination
              label="Account pages"
              page={result.data.page}
              totalPages={pageCount(result.data)}
              total={result.data.total}
              pageSize={result.data.pageSize}
              hrefForPage={page => pageHref(PATH, params, page)}
            />
          </div>
        )
      )}
    </div>
  );
}
