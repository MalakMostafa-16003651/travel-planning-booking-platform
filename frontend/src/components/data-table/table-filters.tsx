import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonClassName } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

/**
 * GEN-05 shared filter bar. A plain GET form: applying filters writes them into the URL and, because
 * the form has no page field, always returns to page 1. It works before JavaScript loads, and the
 * server page reads the same URL. Put FilterSearch / FilterSelect (or your own labelled fields) inside.
 */
export function TableFilters({ action, label = 'Filters', clearHref, children }: {
  /** The list's own path, for example "/admin/accounts". */
  action: string;
  label?: string;
  /** Where "Clear" goes; defaults to the list without any filters. */
  clearHref?: string;
  children: ReactNode;
}) {
  return (
    <form method="get" action={action} role="search" aria-label={label} className="grid gap-4 rounded-card border border-border bg-canvas p-4 md:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] md:items-end">
      {children}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={buttonClassName('primary')}>Apply</button>
        <Link href={clearHref ?? action} className={buttonClassName('secondary')}>Clear</Link>
      </div>
    </form>
  );
}

export function FilterSearch({ name = 'search', label = 'Search', value, placeholder, maxLength = 100 }: {
  name?: string;
  label?: string;
  value?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  const id = `filter-${name}`;
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-ink">{label}</label>
      <Input id={id} name={name} type="search" defaultValue={value ?? ''} placeholder={placeholder} maxLength={maxLength} />
    </div>
  );
}

export function FilterSelect({ name, label, value, options, anyLabel = 'All' }: {
  name: string;
  label: string;
  value?: string;
  options: readonly { value: string; label: string }[];
  /** Label of the empty option that turns the filter off. */
  anyLabel?: string;
}) {
  const id = `filter-${name}`;
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-ink">{label}</label>
      <Select id={id} name={name} defaultValue={value ?? ''}>
        <option value="">{anyLabel}</option>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Select>
    </div>
  );
}

/** A date-only filter (YYYY-MM-DD in the URL). The page decides how the date maps to the API. */
export function FilterDate({ name, label, value, min, max }: { name: string; label: string; value?: string; min?: string; max?: string }) {
  const id = `filter-${name}`;
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-ink">{label}</label>
      <Input id={id} name={name} type="date" defaultValue={value ?? ''} min={min} max={max} />
    </div>
  );
}
