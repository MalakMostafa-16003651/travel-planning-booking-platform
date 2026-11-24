"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { stayDatesError } from "@/features/hotels/date-only";
import { StayDateFields } from "@/features/hotels/date-only-input";

export interface StayCheckFormProps {
  hotelId: string;
  initialCheckIn?: string;
  initialCheckOut?: string;
  initialGuests?: number;
}

/** Prompts for stay dates when a guest lands on a hotel page without search context. */
export function StayCheckForm({ hotelId, initialCheckIn, initialCheckOut, initialGuests }: StayCheckFormProps) {
  const router = useRouter();
  const [dates, setDates] = useState({ checkIn: initialCheckIn ?? "", checkOut: initialCheckOut ?? "" });
  const [guests, setGuests] = useState(initialGuests ?? 1);
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const dateIssue = stayDatesError(dates);
    if (!dates.checkIn || !dates.checkOut) { setError("Choose check-in and check-out dates."); return; }
    if (dateIssue) { setError(dateIssue); return; }
    const params = new URLSearchParams({ checkIn: dates.checkIn, checkOut: dates.checkOut, guests: String(guests) });
    router.push(`/hotels/${hotelId}?${params}`);
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Check room availability" className="grid gap-4 rounded-card border border-border bg-card p-4">
      <h3 className="m-0">Check availability</h3>
      <StayDateFields value={dates} onChange={setDates} idPrefix="sc" />
      <FormField id="sc-guests" label="Guests">
        <Input type="number" min={1} max={50} value={guests} onChange={event => setGuests(Math.max(1, Math.trunc(Number(event.target.value)) || 1))} />
      </FormField>
      {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
      <div><Button type="submit">See available rooms</Button></div>
    </form>
  );
}
