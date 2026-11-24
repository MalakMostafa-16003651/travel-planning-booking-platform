"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/ui/error-alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useDestinations } from "@/features/hotels/hotel-search/use-destinations";
import { ApiError, apiClient } from "@/lib/api/client";
import type { MyHotel } from "./types";

export interface HotelProfileFormProps {
  hotel: MyHotel;
}

export function HotelProfileForm({ hotel }: HotelProfileFormProps) {
  const router = useRouter();
  const { cities, loading: loadingCities } = useDestinations();
  const [name, setName] = useState(hotel.name);
  const [city, setCity] = useState(hotel.city);
  const [address, setAddress] = useState(hotel.address);
  const [description, setDescription] = useState(hotel.description ?? "");
  const [starClass, setStarClass] = useState(hotel.starClass ?? 3);
  const [amenities, setAmenities] = useState(hotel.amenities ?? []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await apiClient(`/hotels/${hotel._id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, city, address, description: description || undefined, starClass, amenities: amenities.filter(Boolean) }),
      });
      setSaved(true);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not save your changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="stack">
      {error && <ErrorAlert message={error} title="Could not save" />}
      <div className="grid gap-4 md:grid-cols-2">
        <FormField id="hp-name" label="Hotel name"><Input value={name} onChange={e => setName(e.target.value)} required /></FormField>
        <FormField id="hp-city" label="City">
          <Select value={city} disabled={loadingCities} onChange={e => setCity(e.target.value)}>
            <option value={city}>{city}</option>
            {cities.filter(c => c.name !== city).map(c => <option key={c.cityId} value={c.name}>{c.name}</option>)}
          </Select>
        </FormField>
        <FormField id="hp-address" label="Address"><Input value={address} onChange={e => setAddress(e.target.value)} required /></FormField>
        <FormField id="hp-star" label="Star class">
          <Select value={starClass} onChange={e => setStarClass(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} star{n === 1 ? "" : "s"}</option>)}
          </Select>
        </FormField>
      </div>
      <FormField id="hp-description" label="Description" hint="Shown on your public hotel page.">
        <textarea
          id="hp-description"
          value={description}
          onChange={e => setDescription(e.target.value)}
          maxLength={2000}
          rows={4}
          className="w-full rounded-control border border-border bg-card px-3 py-2.5 text-base text-body"
        />
      </FormField>
      <div className="grid gap-2">
        <p className="m-0 text-sm font-semibold text-ink">Amenities</p>
        {amenities.map((amenity, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={amenity}
              onChange={e => setAmenities(current => current.map((value, i) => (i === index ? e.target.value : value)))}
              maxLength={100}
            />
            <button type="button" onClick={() => setAmenities(current => current.filter((_, i) => i !== index))} aria-label={`Remove ${amenity || "amenity"}`} className="text-muted hover:text-danger">
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
        <Button type="button" variant="secondary" onClick={() => setAmenities(current => [...current, ""])}><Plus size={16} aria-hidden="true" />Add amenity</Button>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save profile"}</Button>
        {saved && <span role="status" className="text-sm text-success">Saved.</span>}
      </div>
    </form>
  );
}
