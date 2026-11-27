// GEN-05 helpers for lists whose page and filters live in the URL.

export type SearchParams = Record<string, string | string[] | undefined>;

/** The first value of a query parameter, trimmed. Empty values count as absent. */
export function firstParam(params: SearchParams, key: string): string | undefined {
  const raw = params[key];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return value ? value : undefined;
}

/** The value only if it is one of the allowed options (for enum filters such as role or status). */
export function enumParam<T extends string>(params: SearchParams, key: string, allowed: readonly T[]): T | undefined {
  const value = firstParam(params, key);
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** The requested page as a whole number from 1. Anything else reads as page 1. */
export function readPage(params: SearchParams, key = 'page'): number {
  const value = firstParam(params, key);
  if (!value || !/^\d{1,6}$/.test(value)) return 1;
  return Math.max(1, Number(value));
}

/**
 * The number of pages for a server page. Uses the endpoint's own totalPages when it sends one,
 * otherwise derives it from total and pageSize. Never less than 1, so "Page 1 of 1" reads naturally.
 */
export function pageCount(result: { total: number; pageSize: number; totalPages?: number }): number {
  const pages = typeof result.totalPages === 'number' ? result.totalPages : Math.ceil(result.total / Math.max(1, result.pageSize));
  return Math.max(1, pages);
}

/**
 * The same list URL on another page, keeping every other filter. Page 1 is written without a page
 * parameter so each list has one canonical first-page URL.
 */
export function pageHref(pathname: string, params: SearchParams, page: number, key = 'page'): string {
  const query = new URLSearchParams();
  for (const [name, raw] of Object.entries(params)) {
    if (name === key || raw === undefined) continue;
    for (const value of Array.isArray(raw) ? raw : [raw]) if (value.trim()) query.append(name, value);
  }
  if (page > 1) query.set(key, String(page));
  return query.size ? `${pathname}?${query}` : pathname;
}
