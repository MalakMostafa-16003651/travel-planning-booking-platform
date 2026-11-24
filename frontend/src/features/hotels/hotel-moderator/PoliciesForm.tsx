"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/ui/error-alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ApiError, apiClient } from "@/lib/api/client";
import type { CancellationTier } from "../hotel-detail/types";
import type { MyHotel } from "./types";

export interface PoliciesFormProps {
  hotel: MyHotel;
}

export function PoliciesForm({ hotel }: PoliciesFormProps) {
  const router = useRouter();
  const [checkInTime, setCheckInTime] = useState(hotel.checkInTime);
  const [checkOutTime, setCheckOutTime] = useState(hotel.checkOutTime);
  const [tiers, setTiers] = useState<CancellationTier[]>(hotel.cancellationTiers);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  function updateTier(index: number, changes: Partial<CancellationTier>) {
    setTiers(current => current.map((tier, i) => (i === index ? { ...tier, ...changes } : tier)));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await apiClient(`/hotels/${hotel._id}/policies`, {
        method: "PUT",
        body: JSON.stringify({ checkInTime, checkOutTime, cancellationTiers: tiers }),
      });
      setSaved(true);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not save your policies.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="stack">
      {error && <ErrorAlert message={error} title="Could not save" />}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="pf-checkin" label="Check-in time"><Input type="time" value={checkInTime} onChange={e => setCheckInTime(e.target.value)} required /></FormField>
        <FormField id="pf-checkout" label="Check-out time"><Input type="time" value={checkOutTime} onChange={e => setCheckOutTime(e.target.value)} required /></FormField>
      </div>
      <div className="grid gap-2">
        <p className="m-0 text-sm font-semibold text-ink">Cancellation tiers</p>
        <p className="m-0 text-sm text-muted">Refund applies the tier with the highest threshold not exceeding days remaining before check-in.</p>
        {tiers.map((tier, index) => (
          <div key={index} className="flex flex-wrap items-end gap-3 rounded-control border border-border p-3">
            <FormField id={`pf-tier-days-${index}`} label="Days before check-in">
              <Input type="number" min={0} value={tier.daysBeforeCheckIn} onChange={e => updateTier(index, { daysBeforeCheckIn: Math.max(0, Math.trunc(Number(e.target.value)) || 0) })} />
            </FormField>
            <FormField id={`pf-tier-refund-${index}`} label="Refund %">
              <Input type="number" min={0} max={100} value={tier.refundPercentage} onChange={e => updateTier(index, { refundPercentage: Math.max(0, Math.min(100, Math.trunc(Number(e.target.value)) || 0)) })} />
            </FormField>
            <button type="button" onClick={() => setTiers(current => current.filter((_, i) => i !== index))} aria-label={`Remove tier ${index + 1}`} className="mb-2 text-muted hover:text-danger">
              <Trash2 size={18} aria-hidden="true" />
            </button>
          </div>
        ))}
        <Button type="button" variant="secondary" onClick={() => setTiers(current => [...current, { daysBeforeCheckIn: 0, refundPercentage: 0 }])}>
          <Plus size={16} aria-hidden="true" />Add tier
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save policies"}</Button>
        {saved && <span role="status" className="text-sm text-success">Saved.</span>}
      </div>
    </form>
  );
}
