"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorAlert } from "@/components/ui/error-alert";
import { LoadingState } from "@/components/ui/loading-state";
import { ApiError, apiClient } from "@/lib/api/client";
import type { HotelReviewsPage } from "./types";

export interface ReviewsSectionProps {
  hotelId: string;
  initialPage: HotelReviewsPage;
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5 text-sand" aria-label={`${rating} out of 5`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star key={index} size={14} fill={index < rating ? "currentColor" : "none"} aria-hidden="true" />
      ))}
    </span>
  );
}

export function ReviewsSection({ hotelId, initialPage }: ReviewsSectionProps) {
  const [data, setData] = useState(initialPage);
  const [page, setPage] = useState(initialPage.page);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const totalPages = Math.max(1, Math.ceil(data.total / (data.pageSize || 10)));

  function goToPage(next: number) {
    setLoading(true);
    setError("");
    apiClient<HotelReviewsPage>(`/hotels/${hotelId}/reviews?page=${next}`)
      .then(result => { setData(result); setPage(next); })
      .catch(cause => setError(cause instanceof ApiError ? cause.message : "Could not load reviews."))
      .finally(() => setLoading(false));
  }

  return (
    <section aria-labelledby="hotel-reviews-heading" className="stack">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="hotel-reviews-heading" className="m-0">Guest reviews</h2>
        {data.averageRating !== null ? (
          <Badge tone="success">{data.averageRating.toFixed(1)} ★ ({data.ratingCount})</Badge>
        ) : (
          <Badge>Not yet rated</Badge>
        )}
      </div>
      {loading && <LoadingState label="Loading reviews…" />}
      {error && <ErrorAlert message={error} title="Could not load reviews" />}
      {!loading && !error && data.items.length === 0 && (
        <EmptyState title="No reviews yet" description="Be the first to review this hotel after your stay." />
      )}
      {!loading && !error && data.items.map(review => (
        <article key={review.reviewId} className="grid gap-2 rounded-card border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="m-0 font-semibold text-ink">{review.author.name}</p>
            <Stars rating={review.rating} />
          </div>
          {review.comment && <p className="m-0 text-sm text-body">{review.comment}</p>}
          {review.reply && (
            <div className="grid gap-1 rounded-control border border-border bg-canvas p-3">
              <p className="m-0 text-xs font-semibold uppercase tracking-wide text-muted">Response from the hotel</p>
              <p className="m-0 text-sm text-body">{review.reply.text}</p>
            </div>
          )}
        </article>
      ))}
      {!loading && !error && totalPages > 1 && (
        <nav aria-label="Review pagination" className="flex items-center justify-between gap-3">
          <Button variant="secondary" disabled={page <= 1} onClick={() => goToPage(page - 1)}>Previous</Button>
          <span className="text-sm text-muted">Page {page} of {totalPages}</span>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>Next</Button>
        </nav>
      )}
    </section>
  );
}
