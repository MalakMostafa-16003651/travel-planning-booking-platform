"use client";

import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/ui/error-alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useDestinations } from "@/features/hotels/hotel-search/use-destinations";
import { ApiError, apiClient } from "@/lib/api/client";

/** What POST /api/hotels returns that a providers list needs, per #156's proposed shape. */
export interface CreatedHotel {
  id: string;
  name: string;
  city: string;
  isActive: boolean;
  createdAt: string;
}

export interface HotelCreateFormProps {
  /** Admin-only check and the providers-list refresh stay with the caller. May return a promise. */
  onCreated: (hotel: CreatedHotel) => void | Promise<void>;
}

interface RawHotelResponse {
  _id: string;
  name: string;
  city: string;
  isActive: boolean;
  createdAt: string;
}

const emptyAmenity = "";

export function HotelCreateForm({ onCreated }: HotelCreateFormProps) {
  const { cities, loading: loadingCities, error: destinationsError } = useDestinations();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [starClass, setStarClass] = useState(3);
  const [amenities, setAmenities] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setName("");
    setCity("");
    setAddress("");
    setDescription("");
    setStarClass(3);
    setAmenities([]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const created = await apiClient<RawHotelResponse>("/hotels", {
        method: "POST",
        body: JSON.stringify({ name, city, address, description: description || undefined, starClass, amenities: amenities.filter(Boolean) }),
      });
      await onCreated({ id: created._id, name: created.name, city: created.city, isActive: created.isActive, createdAt: created.createdAt });
      reset();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not create this hotel.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Create a hotel" className="stack">
      {destinationsError && <ErrorAlert message={destinationsError} title="Destinations unavailable" />}
      {error && <ErrorAlert message={error} title="Could not create hotel" />}
      <div className="grid gap-4 md:grid-cols-2">
        <FormField id="hcf-name" label="Hotel name"><Input value={name} onChange={e => setName(e.target.value)} required /></FormField>
        <FormField id="hcf-city" label="City">
          <Select value={city} disabled={loadingCities} onChange={e => setCity(e.target.value)} required>
            <option value="">{loadingCities ? "Loading destinations…" : "Select a city"}</option>
            {cities.map(c => <option key={c.cityId} value={c.name}>{c.name}</option>)}
          </Select>
        </FormField>
        <FormField id="hcf-address" label="Address"><Input value={address} onChange={e => setAddress(e.target.value)} required /></FormField>
        <FormField id="hcf-star" label="Star class">
          <Select value={starClass} onChange={e => setStarClass(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} star{n === 1 ? "" : "s"}</option>)}
          </Select>
        </FormField>
      </div>
      <FormField id="hcf-description" label="Description (optional)">
        <textarea
          id="hcf-description"
          value={description}
          onChange={e => setDescription(e.target.value)}
          maxLength={2000}
          rows={3}
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
        <Button type="button" variant="secondary" onClick={() => setAmenities(current => [...current, emptyAmenity])}><Plus size={16} aria-hidden="true" />Add amenity</Button>
      </div>
      <div><Button type="submit" disabled={saving || !city}>{saving ? "Creating…" : "Create hotel"}</Button></div>
    </form>
  );
}
