# GEN-05 DataTable, Pagination and table filters

Builder: Arwa (Person 2). Consumers: every list owner with a list longer than ten.
Import everything from `@/components/data-table`.

| Export | What it is |
| --- | --- |
| `DataTable` | Presentation-only table for one server page of rows |
| `Pagination` | Previous / "Page 2 of 6" / Next, plus "Showing 11–20 of 57" |
| `TableFilters`, `FilterSearch`, `FilterSelect` | Filter bar as a plain GET form, so filters live in the URL |
| `readPage`, `firstParam`, `enumParam`, `pageCount`, `pageHref`, `SearchParams` | URL helpers for server pages |

A live example with sample rows is at `/dev/ui/data-table` in `npm run dev`. The first real
consumer is `/admin/accounts` (`frontend/src/app/admin/accounts/page.tsx`).

## Rules (GEN-05 and the shared rules in the M2 split)

- Page size is the server's: ten. Pass exactly the `items` of the page the API returned.
  Never load everything and slice it, and never slice one API page into several screens.
- Use the server's answer for `page`, `total` and `pageSize`. `pageCount(result)` uses the
  endpoint's `totalPages` when it sends one and otherwise derives it from `total / pageSize`.
- Keep page and filters in the URL where the list is a page of its own, so refresh, back and
  shared links show the same list. Applying filters goes back to page 1.
- Show an empty state for no results, and a "go to the first page" action when the URL asks
  for a page past the end (`total > 0` but no items).

## DataTable

```tsx
import { DataTable, type DataTableColumn } from '@/components/data-table';

const columns: DataTableColumn<AdminAccount>[] = [
  { id: 'name', header: 'Name', rowHeader: true, cell: account => account.name },
  { id: 'email', header: 'Email', cell: account => account.email },
  { id: 'amount', header: 'Amount', align: 'end', cell: row => formatMoneyMinorUnits(row.amount) },
  { id: 'reason', header: 'Reason', wrap: true, cell: row => row.reason },
];

<DataTable caption="Accounts" columns={columns} rows={page.items} rowKey={row => row.userId} empty={<EmptyState title="No accounts yet" />} />
```

| Prop | Type | Notes |
| --- | --- | --- |
| `caption` | `string` | Accessible table name. Visually hidden unless `showCaption` |
| `showCaption` | `boolean?` | Show the caption above the table |
| `columns` | `DataTableColumn<Row>[]` | `id`, `header`, `cell(row)`, optional `align: 'start' \| 'end'`, `rowHeader`, `wrap` |
| `rows` | `Row[]` | The current server page's items |
| `rowKey` | `(row) => string` | Use the API's own ID field (`userId`, `flightBookingId`, …) |
| `empty` | `ReactNode?` | Rendered instead of the table when `rows` is empty |

Cells stay on one line by default and the table scrolls sideways inside its own frame on
small screens, so the page never scrolls sideways. Set `wrap: true` on long-text columns.
Buttons and links inside cells are fine: `cell` returns any React node.

## Pagination

Two modes. Pick one.

**Server page, links (preferred for list pages):**

```tsx
<Pagination
  label="Account pages"
  page={result.page}
  totalPages={pageCount(result)}
  total={result.total}
  pageSize={result.pageSize}
  hrefForPage={page => pageHref('/admin/accounts', searchParams, page)}
/>
```

**Client list that loads pages itself (inside a `'use client'` component):**

```tsx
<Pagination page={page} totalPages={pageCount(data)} onPageChange={goToPage} disabled={loading} />
```

| Prop | Type | Notes |
| --- | --- | --- |
| `page` | `number` | Current page from 1 |
| `totalPages` | `number` | From `pageCount(result)` |
| `total`, `pageSize` | `number?` | Both given: shows "Showing 11–20 of 57" |
| `label` | `string?` | Accessible name of the navigation, default "Pages" |
| `hrefForPage` | `(page) => string` | Link mode |
| `onPageChange`, `disabled` | `(page) => void`, `boolean?` | Callback mode; disable while loading |

With one page it shows only the "Showing" line (when `total` is given).

## Filters

```tsx
<TableFilters action="/admin/accounts" label="Filter accounts">
  <FilterSearch label="Name or email" value={filters.search} />
  <FilterSelect name="role" label="Role" value={filters.role} anyLabel="All roles" options={[{ value: 'USER', label: 'Traveler' }]} />
</TableFilters>
```

The form submits with GET to `action`, so the values land in the URL and the page parameter
is dropped (page 1). Read them back on the server with `firstParam` (trimmed text) and
`enumParam` (only allowed values), then send only those to the API. The backend still
validates; show its 400 message if it rejects a filter. Use the API's own query names.

## Server page example

```tsx
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const page = readPage(params);           // ?page=abc or ?page=0 read as 1
  const status = enumParam(params, 'status', ['ACTIVE', 'SUSPENDED'] as const);
  const result = await loadMyList({ page, status });
  // render TableFilters, DataTable and Pagination
}
```

## Checked

With sample data in Chromium (`next build` + `next start`): ten rows per page, Next/Previous
change `?page=`, filters return to page 1 and survive reload, empty and past-the-end states,
a non-admin gets "Access denied", a guest returns to the same filtered URL after login, and
no sideways page scroll at 360 px. `npm run typecheck` and `npm run build` pass. The real
backend check of `/admin/accounts` against the team test database is still to be recorded.
