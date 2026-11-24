"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/ui/error-alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ApiError, apiClient } from "@/lib/api/client";

export interface RoomCreateFormProps {
  hotelId: string;
}

export function RoomCreateForm({ hotelId }: RoomCreateFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [beds, setBeds] = useState(1);
  const [capacity, setCapacity] = useState(2);
  const [price, setPrice] = useState(100);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await apiClient(`/hotels/${hotelId}/rooms`, {
        method: "POST",
        body: JSON.stringify({ name, type, beds, capacity, pricePerNight: Math.round(price * 100) }),
      });
      router.push("/moderator/hotel/rooms");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not create this room.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="stack">
      {error && <ErrorAlert message={error} title="Could not create room" />}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="rc-name" label="Room name" hint="Unique within your hotel."><Input value={name} onChange={e => setName(e.target.value)} required /></FormField>
        <FormField id="rc-type" label="Type" hint="e.g. Deluxe, Suite, Standard"><Input value={type} onChange={e => setType(e.target.value)} required /></FormField>
        <FormField id="rc-beds" label="Beds"><Input type="number" min={1} value={beds} onChange={e => setBeds(Math.max(1, Math.trunc(Number(e.target.value)) || 1))} /></FormField>
        <FormField id="rc-capacity" label="Max occupancy"><Input type="number" min={1} value={capacity} onChange={e => setCapacity(Math.max(1, Math.trunc(Number(e.target.value)) || 1))} /></FormField>
        <FormField id="rc-price" label="Price per night (USD)"><Input type="number" min={0.01} step={0.01} value={price} onChange={e => setPrice(Math.max(0.01, Number(e.target.value) || 0.01))} /></FormField>
      </div>
      <div><Button type="submit" disabled={saving}>{saving ? "Creating…" : "Add room"}</Button></div>
    </form>
  );
}
