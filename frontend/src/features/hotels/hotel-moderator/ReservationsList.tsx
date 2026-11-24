"use client";

import { useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorAlert } from "@/components/ui/error-alert";
import { formatHotelPrice } from "@/features/hotels/hotel-search/format";
import { ApiError, apiClient } from "@/lib/api/client";
import type { ReservationsPage } from "./types";

export interface ReservationsListProps {
  hotelId: string;
  initialPage: ReservationsPage;
}

const statusTone: Record<string, BadgeTone> = { CONFIRMED: "success", PENDING: "warning", CANCELLED: "danger", COMPLETED: "info" };

export function ReservationsList({ hotelId, initialPage }: ReservationsListProps) {
  const [data, setData] = useState(initialPage);
  const [page, setPage] = useState(initialPage.page);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const totalPages = Math.max(1, Math.ceil(data.total / (data.pageSize || 10)));

  function goToPage(next: number) {
    setLoading(true);
    setError("");
    apiClient<ReservationsPage>(`/hotels/${hotelId}/reservations?page=${next}`)
      .then(result => { setData(result); setPage(next); })
      .catch(cause => setError(cause instanceof ApiError ? cause.message : "Could not load reservations."))
      .finally(() => setLoading(false));
  }

  if (data.items.length === 0 && !loading && !error) {
    return <EmptyState title="No reservations yet" description="Reservations for your hotel will appear here." />;
  }

  return (
    <div className="stack">
      {error && <ErrorAlert message={error} title="Could not load reservations" />}
      {data.items.map(reservation => (
        <Card key={reservation.hotelBookingId} className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="m-0 font-semibold text-ink">{reservation.bookingReference ?? reservation.hotelBookingId}</p>
            <Badge tone={statusTone[reservation.status] ?? "neutral"}>{reservation.status}</Badge>
          </div>
          <p className="m-0 text-sm text-muted">{reservation.guestName ?? "Guest"} · {reservation.checkIn} → {reservation.checkOut} · {reservation.guestCount} guest(s)</p>
          <p className="m-0 text-sm text-muted">{reservation.rooms.map(room => room.roomName).join(", ")}</p>
          <p className="m-0 font-semibold text-ink">{formatHotelPrice(reservation.totalAmount, reservation.currency)}</p>
        </Card>
      ))}
      {totalPages > 1 && (
        <nav aria-label="Reservation pagination" className="flex items-center justify-between gap-3">
          <Button variant="secondary" disabled={page <= 1 || loading} onClick={() => goToPage(page - 1)}>Previous</Button>
          <span className="text-sm text-muted">Page {page} of {totalPages}</span>
          <Button variant="secondary" disabled={page >= totalPages || loading} onClick={() => goToPage(page + 1)}>Next</Button>
        </nav>
      )}
    </div>
  );
}
