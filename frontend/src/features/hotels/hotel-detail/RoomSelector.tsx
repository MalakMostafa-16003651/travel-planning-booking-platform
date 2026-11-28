"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { formatHotelPrice } from "../hotel-search/format";
import type { HotelSelection, Page } from "../hotel-search/types";
import type { AvailableRoom } from "./types";

export interface RoomSelectorProps {
  hotelId: string;
  rooms: Page<AvailableRoom>;
  checkIn: string;
  checkOut: string;
  initialGuests: number;
  /** Osama's booking page; adjust once he confirms the final route. */
  bookingHref?: string;
}

export function RoomSelector({ hotelId, rooms, checkIn, checkOut, initialGuests, bookingHref = "/bookings/hotels/new" }: RoomSelectorProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adults, setAdults] = useState(Math.max(1, initialGuests));
  const [childrenAges, setChildrenAges] = useState<number[]>([]);

  if (rooms.items.length === 0) {
    return <EmptyState title="No rooms available" description="Try different dates, fewer guests, or another hotel." />;
  }

  const selectedRooms = rooms.items.filter(room => selected.has(room.roomId));
  const total = selectedRooms.reduce((sum, room) => sum + room.totalStayPrice, 0);
  const currency = rooms.items[0].currency;

  function toggle(roomId: string) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  }

  function updateChild(index: number, age: number) {
    setChildrenAges(current => current.map((value, i) => (i === index ? Math.max(0, Math.min(17, age)) : value)));
  }

  function bookingUrl(): string {
    const selection: HotelSelection = { hotelId, roomIds: [...selected], checkIn, checkOut, adults, childrenAges };
    return `${bookingHref}?selection=${encodeURIComponent(JSON.stringify(selection))}`;
  }

  return (
    <div className="stack">
      <div className="grid gap-3">
        {rooms.items.map(room => (
          <label
            key={room.roomId}
            className={`flex cursor-pointer items-center justify-between gap-4 rounded-card border p-4 ${selected.has(room.roomId) ? "border-primary bg-primary/5" : "border-border bg-card"}`}
          >
            <span className="flex items-start gap-3">
              <input type="checkbox" checked={selected.has(room.roomId)} onChange={() => toggle(room.roomId)} className="mt-1 size-4" />
              <span className="grid gap-1">
                <span className="font-semibold text-ink">{room.name}</span>
                <span className="text-sm text-muted">{room.type ?? "Room"} · {room.beds ?? "—"} bed(s) · up to {room.capacity} guests</span>
              </span>
            </span>
            <span className="text-right">
              <span className="block font-semibold text-ink">{formatHotelPrice(room.totalStayPrice, room.currency)}</span>
              <span className="block text-sm text-muted">{formatHotelPrice(room.pricePerNight, room.currency)}/night</span>
            </span>
          </label>
        ))}
      </div>
      {selected.size > 0 && (
        <Card className="grid gap-4">
          <h3 className="m-0">Who&apos;s staying</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="rs-adults" label="Adults">
              <Input type="number" min={1} max={50} value={adults} onChange={event => setAdults(Math.max(1, Math.trunc(Number(event.target.value)) || 1))} />
            </FormField>
            <div className="grid gap-2">
              <p className="m-0 text-sm font-semibold text-ink">Children (0–17)</p>
              {childrenAges.map((age, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input type="number" min={0} max={17} value={age} onChange={event => updateChild(index, Math.trunc(Number(event.target.value)) || 0)} />
                  <button type="button" onClick={() => setChildrenAges(current => current.filter((_, i) => i !== index))} aria-label={`Remove child ${index + 1}`} className="text-muted hover:text-danger">
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <Button variant="secondary" onClick={() => setChildrenAges(current => [...current, 0])}><Plus size={16} aria-hidden="true" />Add a child</Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div>
              <p className="m-0 text-sm text-muted">{selectedRooms.length} room{selectedRooms.length === 1 ? "" : "s"} selected</p>
              <p className="m-0 text-xl font-semibold text-ink">{formatHotelPrice(total, currency)} total</p>
            </div>
            <Link href={bookingUrl()} className={buttonClassName("primary")}>Continue to booking</Link>
          </div>
        </Card>
      )}
    </div>
  );
}
