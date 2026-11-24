"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/ui/error-alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { stayDatesError } from "@/features/hotels/date-only";
import { StayDateFields } from "@/features/hotels/date-only-input";
import { criteriaToParams } from "./format";
import type { HotelSearchCriteria } from "./types";
import { useDestinations } from "./use-destinations";

export type { HotelSearchCriteria } from "./types";

export interface HotelSearchProps {
  /** "home" is the compact landing-page version; "full" sits above results on /hotels. */
  variant?: "home" | "full";
  initialCriteria?: Partial<HotelSearchCriteria>;
}

type Errors = Partial<Record<"destination" | "dates" | "guests", string>>;

function destinationValue(criteria?: Partial<HotelSearchCriteria>): string {
  if (!criteria) return "";
  if (criteria.city) return `city:${criteria.city}`;
  if (criteria.countryCode) return `country:${criteria.countryCode}`;
  return "";
}

export function HotelSearch({ variant = "full", initialCriteria }: HotelSearchProps) {
  const router = useRouter();
  const { cities, countries, loading, error: destinationsError } = useDestinations();
  const [destination, setDestination] = useState(destinationValue(initialCriteria));
  const [dates, setDates] = useState({ checkIn: initialCriteria?.checkIn ?? "", checkOut: initialCriteria?.checkOut ?? "" });
  const [guests, setGuests] = useState(initialCriteria?.guests ?? 1);
  const [rooms, setRooms] = useState(initialCriteria?.rooms ?? 1);
  const [errors, setErrors] = useState<Errors>({});

  function validate(): Errors {
    const found: Errors = {};
    if (!destination) found.destination = "Choose a city or country.";
    const dateIssue = stayDatesError(dates);
    if (!dates.checkIn || !dates.checkOut) found.dates = "Choose check-in and check-out dates.";
    else if (dateIssue) found.dates = dateIssue;
    if (guests < 1) found.guests = "At least one guest is required.";
    return found;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) return;
    const [kind, value] = destination.split(":");
    const params = criteriaToParams({
      city: kind === "city" ? value : undefined,
      countryCode: kind === "country" ? value : undefined,
      checkIn: dates.checkIn,
      checkOut: dates.checkOut,
      guests,
      rooms,
    });
    router.push(`/hotels?${params}`);
  }

  const count = (value: number, set: (n: number) => void, min: number, max: number) => (
    <Input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={value}
      onChange={event => set(Math.max(min, Math.min(max, Math.trunc(Number(event.target.value)) || min)))}
    />
  );

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Search hotels"
      className={variant === "home" ? "grid gap-4 rounded-card border border-border bg-card p-4 md:p-6" : "grid gap-4"}
    >
      {destinationsError && <ErrorAlert message={destinationsError} title="Destinations unavailable" />}
      <div className="grid gap-4 md:grid-cols-2">
        <FormField id="hs-destination" label="Destination" error={errors.destination}>
          <Select value={destination} disabled={loading} onChange={event => setDestination(event.target.value)}>
            <option value="">{loading ? "Loading destinations…" : "Select a city or country"}</option>
            <optgroup label="Cities">
              {cities.map(city => (
                <option key={city.cityId} value={`city:${city.name}`}>{city.name}</option>
              ))}
            </optgroup>
            <optgroup label="Anywhere in a country">
              {countries.map(country => (
                <option key={country.code} value={`country:${country.code}`}>Anywhere in {country.name}</option>
              ))}
            </optgroup>
          </Select>
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="hs-guests" label="Guests">{count(guests, setGuests, 1, 50)}</FormField>
          <FormField id="hs-rooms" label="Rooms">{count(rooms, setRooms, 1, 20)}</FormField>
        </div>
      </div>
      <StayDateFields value={dates} onChange={setDates} idPrefix="hs" />
      {errors.dates && <p role="alert" className="m-0 text-sm text-danger">{errors.dates}</p>}
      {errors.guests && <p role="alert" className="m-0 text-sm text-danger">{errors.guests}</p>}
      <div><Button type="submit"><Search size={18} aria-hidden="true" />Search hotels</Button></div>
    </form>
  );
}
