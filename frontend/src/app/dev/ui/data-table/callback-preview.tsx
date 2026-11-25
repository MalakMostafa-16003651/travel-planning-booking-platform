'use client';

import { useState } from 'react';
import { Pagination } from '@/components/data-table';

/** Development preview of the callback mode, for lists that load the next page in the browser. */
export function CallbackPaginationPreview() {
  const [page, setPage] = useState(1);
  return (
    <div className="grid gap-3">
      <p className="m-0 text-sm text-muted">Showing page {page}. A real list calls its API here and disables the buttons while loading.</p>
      <Pagination page={page} totalPages={3} total={27} pageSize={10} label="Preview pages" onPageChange={setPage} />
    </div>
  );
}
