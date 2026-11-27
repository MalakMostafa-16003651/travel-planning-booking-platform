'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** Removes a one-time query parameter (?deleted=1, ?saved=draft) so a reload does not repeat its message. */
export function useDropQueryParam(name: string) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    if (!search.has(name)) return;
    const rest = new URLSearchParams(search);
    rest.delete(name);
    router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false });
  }, [name, pathname, router, search]);
}

/**
 * A success message carried by a query parameter. It keeps the first message it was given, so it stays
 * visible after the parameter is removed from the URL. Render it in the same place on every render.
 */
export function FlashNotice({ message, param }: { message: string | null; param: string }) {
  const [shown] = useState(message);
  useDropQueryParam(param);
  if (!shown) return null;
  return <p role="status" className="m-0 rounded-control border border-success/25 bg-success/10 p-4 text-sm text-ink">{shown}</p>;
}
