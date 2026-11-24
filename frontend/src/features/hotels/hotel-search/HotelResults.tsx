"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorAlert } from "@/components/ui/error-alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/ui/loading-state";
import { Select } from "@/components/ui/select";
import { ApiError, apiClient } from "@/lib/api/client";
import { criteriaToParams } from "./format";
import { HotelCard } from "./HotelCard";
import type { HotelSearchCriteria, HotelSearchResult, Page } from "./types";

export interface HotelResultsProps {
  criteria: HotelSearchCriteria;
  page: number;
}

function toMinorOrUndefined(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? String(Math.round(n * 100)) : undefined;
}

export function HotelResults({ criteria, page }: HotelResultsProps) {
  const router = useRouter();
  const [result, setResult] = useState<Page<HotelSearchResult> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [minPrice, setMinPrice] = useState(criteria.minPrice !== undefined ? String(criteria.minPrice / 100) : "");
  const [maxPrice, setMaxPrice] = useState(criteria.maxPrice !== undefined ? String(criteria.maxPrice / 100) : "");

  const baseParams = useMemo(() => criteriaToParams(criteria), [criteria]);
  const query = useMemo(() => {
    const params = new URLSearchParams(baseParams);
    params.set("page", String(page));
    return params.toString();
  }, [baseParams, page]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    apiClient<Page<HotelSearchResult>>(`/hotels/search?${query}`)
      .then(data => { if (alive) setResult(data); })
      .catch(cause => { if (alive) setError(cause instanceof ApiError ? cause.message : "Could not load hotels."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [query]);

  function go(changes: Record<string, string | undefined>) {
    const params = new URLSearchParams(baseParams);
    const next: Record<string, string | undefined> = { page: String(page), ...changes };
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.push(`/hotels?${params}`);
  }

  const filtersChanged = (changes: Record<string, string | undefined>) => go({ page: "1", ...changes });

  const totalPages = result ? (result.totalPages ?? Math.max(1, Math.ceil(result.total / (result.pageSize || 10)))) : 1;

  return (
    <div className="stack">
      <div className="grid gap-4 rounded-card border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField id="hr-sort" label="Sort by">
          <Select value={criteria.sort ?? ""} onChange={event => filtersChanged({ sort: event.target.value || undefined })}>
            <option value="">Name</option>
            <option value="PRICE_ASC">Price (lowest)</option>
            <option value="PRICE_DESC">Price (highest)</option>
            <option value="RATING_DESC">Rating</option>
          </Select>
        </FormField>
        <FormField id="hr-min-rating" label="Minimum rating">
          <Select value={criteria.minRating ?? ""} onChange={event => filtersChanged({ minRating: event.target.value || undefined })}>
            <option value="">Any rating</option>
            {[1, 2, 3, 4, 5].map(stars => <option key={stars} value={stars}>{stars}+ stars</option>)}
          </Select>
        </FormField>
        <FormField id="hr-min-price" label="Min price (USD)"><Input type="number" min={0} inputMode="decimal" value={minPrice} onChange={event => setMinPrice(event.target.value)} /></FormField>
        <FormField id="hr-max-price" label="Max price (USD)"><Input type="number" min={0} inputMode="decimal" value={maxPrice} onChange={event => setMaxPrice(event.target.value)} /></FormField>
        <div className="sm:col-span-2 lg:col-span-4">
          <Button variant="secondary" onClick={() => filtersChanged({ minPrice: toMinorOrUndefined(minPrice), maxPrice: toMinorOrUndefined(maxPrice) })}>Apply price filter</Button>
        </div>
      </div>
      {loading && <LoadingState label="Searching hotels…" />}
      {error && <ErrorAlert message={error} title="Search failed" />}
      {!loading && !error && result?.items.length === 0 && (
        <EmptyState title="No hotels found" description="Try other dates, a wider price range or a different destination." />
      )}
      {!loading && !error && result && result.items.length > 0 && (
        <div className="grid gap-4">
          {result.items.map(hotel => (
            <HotelCard key={hotel.hotelId} hotel={hotel} checkIn={criteria.checkIn} checkOut={criteria.checkOut} guests={criteria.guests} rooms={criteria.rooms} />
          ))}
        </div>
      )}
      {!loading && !error && totalPages > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
          <Button variant="secondary" disabled={page <= 1} onClick={() => go({ page: String(page - 1) })}>Previous</Button>
          <span className="text-sm text-muted">Page {page} of {totalPages}</span>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => go({ page: String(page + 1) })}>Next</Button>
        </nav>
      )}
    </div>
  );
}
