import { formatMoneyMinorUnits } from "@/lib/format/money";
import { HOTEL_SORTS, type HotelSearchCriteria, type HotelSort } from "./types";

export function formatHotelPrice(minor: number, currency: string): string {
  return formatMoneyMinorUnits(minor, currency);
}

export function criteriaToParams(criteria: Partial<HotelSearchCriteria>): URLSearchParams {
  const params = new URLSearchParams();
  if (criteria.city) params.set("city", criteria.city);
  if (criteria.countryCode) params.set("countryCode", criteria.countryCode);
  if (criteria.checkIn) params.set("checkIn", criteria.checkIn);
  if (criteria.checkOut) params.set("checkOut", criteria.checkOut);
  params.set("guests", String(criteria.guests ?? 1));
  if (criteria.rooms && criteria.rooms !== 1) params.set("rooms", String(criteria.rooms));
  if (criteria.minPrice !== undefined) params.set("minPrice", String(criteria.minPrice));
  if (criteria.maxPrice !== undefined) params.set("maxPrice", String(criteria.maxPrice));
  if (criteria.minRating !== undefined) params.set("minRating", String(criteria.minRating));
  if (criteria.sort) params.set("sort", criteria.sort);
  return params;
}

type Raw = Record<string, string | string[] | undefined>;
const first = (value: Raw[string]) => (Array.isArray(value) ? value[0] : value);
function numberOrUndefined(value: Raw[string]): number | undefined {
  const raw = first(value);
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function paramsToCriteria(raw: Raw): Partial<HotelSearchCriteria> {
  const sort = first(raw.sort);
  return {
    city: first(raw.city) || undefined,
    countryCode: first(raw.countryCode) || undefined,
    checkIn: first(raw.checkIn) ?? "",
    checkOut: first(raw.checkOut) ?? "",
    guests: Math.max(1, numberOrUndefined(raw.guests) ?? 1),
    rooms: Math.max(1, numberOrUndefined(raw.rooms) ?? 1),
    minPrice: numberOrUndefined(raw.minPrice),
    maxPrice: numberOrUndefined(raw.maxPrice),
    minRating: numberOrUndefined(raw.minRating),
    sort: HOTEL_SORTS.includes(sort as HotelSort) ? (sort as HotelSort) : undefined,
  };
}
