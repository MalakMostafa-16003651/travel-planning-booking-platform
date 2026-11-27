import { notFound } from 'next/navigation';
import { DataTable, FilterSearch, FilterSelect, Pagination, TableFilters, enumParam, firstParam, pageCount, pageHref, readPage, type DataTableColumn, type SearchParams } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { CallbackPaginationPreview } from './callback-preview';

export const dynamic = 'force-dynamic';

const PATH = '/dev/ui/data-table';
const PAGE_SIZE = 10;
const kinds = ['Flight', 'Hotel'] as const;

// Development preview only. Real lists pass one server page; this stands in for that server.
const sample = Array.from({ length: 23 }, (_, index) => ({
  id: `row-${index + 1}`,
  reference: `REF-${String(index + 1).padStart(3, '0')}`,
  kind: kinds[index % 2],
  amount: (index + 1) * 1250,
}));
type SampleRow = (typeof sample)[number];

const columns: DataTableColumn<SampleRow>[] = [
  { id: 'reference', header: 'Reference', rowHeader: true, cell: row => row.reference },
  { id: 'kind', header: 'Type', cell: row => <Badge tone={row.kind === 'Flight' ? 'info' : 'neutral'}>{row.kind}</Badge> },
  { id: 'amount', header: 'Amount', align: 'end', cell: row => `$${(row.amount / 100).toFixed(2)}` },
];

function fakeServerPage(page: number, search?: string, kind?: string) {
  const matching = sample.filter(row => (!search || row.reference.toLowerCase().includes(search.toLowerCase())) && (!kind || row.kind === kind));
  return { items: matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), page, pageSize: PAGE_SIZE, total: matching.length };
}

export default async function DataTableGalleryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (process.env.NODE_ENV !== 'development') notFound();
  const params = await searchParams;
  const search = firstParam(params, 'search');
  const kind = enumParam(params, 'kind', kinds);
  const result = fakeServerPage(readPage(params), search, kind);

  return (
    <div className="page-container page-content stack">
      <div>
        <p className="eyebrow">Development only</p>
        <h1 className="section-heading">DataTable and Pagination (GEN-05)</h1>
        <p className="muted">Sample rows. Page and filters live in the URL; applying filters returns to page 1. See docs/m2/DATA_TABLE.md.</p>
      </div>
      <TableFilters action={PATH} label="Filter sample rows">
        <FilterSearch label="Reference" value={search} placeholder="REF-012" />
        <FilterSelect name="kind" label="Type" value={kind} anyLabel="All types" options={kinds.map(value => ({ value, label: value }))} />
      </TableFilters>
      <DataTable caption="Sample bookings" showCaption columns={columns} rows={result.items} rowKey={row => row.id} empty={<EmptyState title="No rows match" />} />
      <Pagination page={result.page} totalPages={pageCount(result)} total={result.total} pageSize={result.pageSize} hrefForPage={page => pageHref(PATH, params, page)} />
      <Card className="stack">
        <h2 className="m-0">Client list with onPageChange</h2>
        <CallbackPaginationPreview />
      </Card>
    </div>
  );
}
