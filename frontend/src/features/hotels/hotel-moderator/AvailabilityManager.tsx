"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorAlert } from "@/components/ui/error-alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { DateOnlyInput } from "@/features/hotels/date-only-input";
import { ApiError, apiClient } from "@/lib/api/client";
import type { BookableRange, RoomAvailabilityItem, RoomAvailabilityPage } from "./types";

export interface AvailabilityManagerProps {
  hotelId: string;
  initialData: RoomAvailabilityPage;
  initialFrom: string;
  initialTo: string;
}

const statusTone: Record<string, BadgeTone> = { AVAILABLE: "success", BOOKED: "info", BLOCKED: "neutral" };

function RoomAvailabilityCard({ hotelId, room, onRefresh }: { hotelId: string; room: RoomAvailabilityItem; onRefresh: () => void }) {
  const [ranges, setRanges] = useState<BookableRange[]>(room.bookableRanges);
  const [savingRanges, setSavingRanges] = useState(false);
  const [rangesError, setRangesError] = useState("");
  const [blockStart, setBlockStart] = useState("");
  const [blockEnd, setBlockEnd] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [blockError, setBlockError] = useState("");

  async function saveRanges() {
    setSavingRanges(true);
    setRangesError("");
    try {
      await apiClient(`/hotels/${hotelId}/rooms/${room.roomId}/bookable-ranges`, {
        method: "PUT",
        body: JSON.stringify({ ranges }),
      });
      onRefresh();
    } catch (cause) {
      setRangesError(cause instanceof ApiError ? cause.message : "Could not save bookable dates.");
    } finally {
      setSavingRanges(false);
    }
  }

  async function blockDates() {
    setBlocking(true);
    setBlockError("");
    try {
      await apiClient(`/hotels/${hotelId}/rooms/${room.roomId}/availability`, {
        method: "POST",
        body: JSON.stringify({ startDate: blockStart, endDate: blockEnd, reason: blockReason || undefined }),
      });
      setBlockStart("");
      setBlockEnd("");
      setBlockReason("");
      onRefresh();
    } catch (cause) {
      setBlockError(cause instanceof ApiError ? cause.message : "Could not block these dates.");
    } finally {
      setBlocking(false);
    }
  }

  async function unblock(blockedRangeId: string) {
    await apiClient(`/hotels/${hotelId}/rooms/${room.roomId}/availability`, {
      method: "PATCH",
      body: JSON.stringify({ blockedRangeId, remove: true }),
    });
    onRefresh();
  }

  return (
    <Card className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0">{room.roomName}</h3>
        {!room.isActive && <Badge tone="warning">Deactivated</Badge>}
      </div>

      <div className="flex flex-wrap gap-1 overflow-x-auto pb-1">
        {room.days.map(day => (
          <span key={day.date} title={`${day.date}: ${day.status}${day.reason ? ` (${day.reason})` : ""}${day.bookingReference ? ` (${day.bookingReference})` : ""}`}>
            <Badge tone={statusTone[day.status] ?? "neutral"}>{day.date.slice(5)}</Badge>
          </span>
        ))}
        {room.days.length === 0 && <p className="m-0 text-sm text-muted">No days in the selected window.</p>}
      </div>

      <div className="grid gap-2">
        <p className="m-0 text-sm font-semibold text-ink">Bookable date ranges</p>
        {rangesError && <ErrorAlert message={rangesError} title="Could not save" />}
        {ranges.map((range, index) => (
          <div key={index} className="flex flex-wrap items-end gap-3">
            <FormField id={`ar-start-${room.roomId}-${index}`} label="Start">
              <DateOnlyInput value={range.startDate} onChange={value => setRanges(current => current.map((r, i) => (i === index ? { ...r, startDate: value } : r)))} />
            </FormField>
            <FormField id={`ar-end-${room.roomId}-${index}`} label="End (exclusive)">
              <DateOnlyInput value={range.endDate} onChange={value => setRanges(current => current.map((r, i) => (i === index ? { ...r, endDate: value } : r)))} />
            </FormField>
            <button type="button" onClick={() => setRanges(current => current.filter((_, i) => i !== index))} aria-label={`Remove range ${index + 1}`} className="mb-2 text-muted hover:text-danger">
              <Trash2 size={18} aria-hidden="true" />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setRanges(current => [...current, { startDate: "", endDate: "" }])}><Plus size={16} aria-hidden="true" />Add range</Button>
          <Button onClick={saveRanges} disabled={savingRanges}>{savingRanges ? "Saving…" : "Save bookable dates"}</Button>
        </div>
      </div>

      <div className="grid gap-2 border-t border-border pt-4">
        <p className="m-0 text-sm font-semibold text-ink">Blocked date ranges</p>
        {room.blockedRanges.length === 0 && <p className="m-0 text-sm text-muted">No blocked dates.</p>}
        {room.blockedRanges.map(range => (
          <div key={range._id} className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border px-3 py-2">
            <span className="text-sm">{range.startDate} – {range.endDate}{range.reason ? ` (${range.reason})` : ""}</span>
            <Button variant="secondary" onClick={() => unblock(range._id)}>Unblock</Button>
          </div>
        ))}
        {blockError && <ErrorAlert message={blockError} title="Could not block dates" />}
        <div className="flex flex-wrap items-end gap-3">
          <FormField id={`bl-start-${room.roomId}`} label="Block from"><DateOnlyInput value={blockStart} onChange={setBlockStart} /></FormField>
          <FormField id={`bl-end-${room.roomId}`} label="Block until (exclusive)"><DateOnlyInput value={blockEnd} onChange={setBlockEnd} /></FormField>
          <FormField id={`bl-reason-${room.roomId}`} label="Reason (optional)"><Input value={blockReason} onChange={e => setBlockReason(e.target.value)} maxLength={200} /></FormField>
          <Button variant="secondary" onClick={blockDates} disabled={blocking || !blockStart || !blockEnd}>{blocking ? "Blocking…" : "Block dates"}</Button>
        </div>
      </div>
    </Card>
  );
}

export function AvailabilityManager({ hotelId, initialData, initialFrom, initialTo }: AvailabilityManagerProps) {
  const router = useRouter();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  return (
    <div className="stack">
      <div className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-card p-4">
        <FormField id="am-from" label="From"><DateOnlyInput value={from} onChange={setFrom} /></FormField>
        <FormField id="am-to" label="To"><DateOnlyInput value={to} onChange={setTo} /></FormField>
        <Button variant="secondary" onClick={() => router.push(`/moderator/hotel/availability?from=${from}&to=${to}`)}>View window</Button>
      </div>
      {initialData.items.map(room => (
        <RoomAvailabilityCard key={room.roomId} hotelId={hotelId} room={room} onRefresh={() => router.refresh()} />
      ))}
    </div>
  );
}
