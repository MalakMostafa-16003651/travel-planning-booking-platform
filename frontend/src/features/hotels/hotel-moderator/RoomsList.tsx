"use client";

import { useState } from "react";
import Link from "next/link";
import { buttonClassName, Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorAlert } from "@/components/ui/error-alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { formatHotelPrice } from "@/features/hotels/hotel-search/format";
import { ApiError, apiClient } from "@/lib/api/client";
import type { ModeratorRoom, RoomsPage } from "./types";

export interface RoomsListProps {
  hotelId: string;
  initialPage: RoomsPage;
}

interface Draft {
  name: string;
  type: string;
  beds: number;
  capacity: number;
  pricePerNight: number;
}

function draftFrom(room: ModeratorRoom): Draft {
  return { name: room.name, type: room.type ?? "", beds: room.beds ?? 1, capacity: room.capacity, pricePerNight: room.pricePerNight / 100 };
}

export function RoomsList({ hotelId, initialPage }: RoomsListProps) {
  const [data, setData] = useState(initialPage);
  const [page, setPage] = useState(initialPage.page);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const totalPages = Math.max(1, Math.ceil(data.total / (data.pageSize || 10)));

  function goToPage(next: number) {
    setLoading(true);
    setListError("");
    apiClient<RoomsPage>(`/hotels/${hotelId}/rooms?page=${next}`)
      .then(result => { setData(result); setPage(next); })
      .catch(cause => setListError(cause instanceof ApiError ? cause.message : "Could not load rooms."))
      .finally(() => setLoading(false));
  }

  function startEdit(room: ModeratorRoom) {
    setEditingId(room._id);
    setDraft(draftFrom(room));
    setRowError(current => ({ ...current, [room._id]: "" }));
  }

  async function saveEdit(roomId: string) {
    if (!draft) return;
    setSaving(roomId);
    setRowError(current => ({ ...current, [roomId]: "" }));
    try {
      const updated = await apiClient<ModeratorRoom>(`/hotels/${hotelId}/rooms/${roomId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: draft.name, type: draft.type, beds: draft.beds, capacity: draft.capacity, pricePerNight: Math.round(draft.pricePerNight * 100) }),
      });
      setData(current => ({ ...current, items: current.items.map(room => (room._id === roomId ? updated : room)) }));
      setEditingId(null);
    } catch (cause) {
      setRowError(current => ({ ...current, [roomId]: cause instanceof ApiError ? cause.message : "Could not save this room." }));
    } finally {
      setSaving(null);
    }
  }

  async function toggleActive(room: ModeratorRoom) {
    setSaving(room._id);
    setRowError(current => ({ ...current, [room._id]: "" }));
    try {
      const updated = await apiClient<ModeratorRoom>(`/hotels/${hotelId}/rooms/${room._id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !room.isActive }),
      });
      setData(current => ({ ...current, items: current.items.map(existing => (existing._id === room._id ? updated : existing)) }));
    } catch (cause) {
      setRowError(current => ({ ...current, [room._id]: cause instanceof ApiError ? cause.message : "Could not update this room." }));
    } finally {
      setSaving(null);
    }
  }

  async function deleteRoom(roomId: string) {
    await apiClient(`/hotels/${hotelId}/rooms/${roomId}`, { method: "DELETE" });
    setData(current => ({ ...current, items: current.items.filter(room => room._id !== roomId), total: current.total - 1 }));
  }

  return (
    <div className="stack">
      <div className="flex justify-end">
        <Link href="/moderator/hotel/rooms/new" className={buttonClassName("primary", "!text-white")}>Add room</Link>
      </div>
      {listError && <ErrorAlert message={listError} title="Could not load rooms" />}
      <div className="grid gap-3">
        {data.items.map(room => (
          <Card key={room._id} className="grid gap-3">
            {editingId === room._id && draft ? (
              <div className="grid gap-3 sm:grid-cols-4">
                <FormField id={`rl-name-${room._id}`} label="Name"><Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></FormField>
                <FormField id={`rl-type-${room._id}`} label="Type"><Input value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })} /></FormField>
                <FormField id={`rl-beds-${room._id}`} label="Beds"><Input type="number" min={1} value={draft.beds} onChange={e => setDraft({ ...draft, beds: Math.max(1, Math.trunc(Number(e.target.value)) || 1) })} /></FormField>
                <FormField id={`rl-capacity-${room._id}`} label="Capacity"><Input type="number" min={1} value={draft.capacity} onChange={e => setDraft({ ...draft, capacity: Math.max(1, Math.trunc(Number(e.target.value)) || 1) })} /></FormField>
                <FormField id={`rl-price-${room._id}`} label="Price per night (USD)"><Input type="number" min={0.01} step={0.01} value={draft.pricePerNight} onChange={e => setDraft({ ...draft, pricePerNight: Math.max(0.01, Number(e.target.value) || 0.01) })} /></FormField>
                <div className="flex items-end gap-2">
                  <Button onClick={() => saveEdit(room._id)} disabled={saving === room._id}>{saving === room._id ? "Saving…" : "Save"}</Button>
                  <Button variant="secondary" onClick={() => setEditingId(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="m-0 font-semibold text-ink">{room.name} {!room.isActive && <Badge tone="warning">Deactivated</Badge>}</p>
                  <p className="m-0 text-sm text-muted">{room.type ?? "Room"} · {room.beds ?? "—"} bed(s) · up to {room.capacity} guests · {formatHotelPrice(room.pricePerNight, "USD")}/night</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => startEdit(room)}>Edit</Button>
                  <Button variant="secondary" onClick={() => toggleActive(room)} disabled={saving === room._id}>{room.isActive ? "Deactivate" : "Reactivate"}</Button>
                  <ConfirmDialog
                    triggerLabel="Delete"
                    title={`Delete ${room.name}?`}
                    description="This only succeeds for a room that has never been reserved."
                    confirmLabel="Delete room"
                    onConfirm={() => deleteRoom(room._id)}
                  />
                </div>
              </div>
            )}
            {rowError[room._id] && <p role="alert" className="m-0 text-sm text-danger">{rowError[room._id]}</p>}
          </Card>
        ))}
      </div>
      {totalPages > 1 && (
        <nav aria-label="Room pagination" className="flex items-center justify-between gap-3">
          <Button variant="secondary" disabled={page <= 1 || loading} onClick={() => goToPage(page - 1)}>Previous</Button>
          <span className="text-sm text-muted">Page {page} of {totalPages}</span>
          <Button variant="secondary" disabled={page >= totalPages || loading} onClick={() => goToPage(page + 1)}>Next</Button>
        </nav>
      )}
    </div>
  );
}
