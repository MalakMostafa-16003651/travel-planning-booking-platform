// Browser mutations for ITN-01/05/07/08/20. Every itinerary mutation returns the full,
// freshly recomputed ItineraryDto (day numbers, dates, city groups), so callers replace
// their state with the response instead of patching it locally.
import { apiClient } from '@/lib/api/client';
import type { Itinerary, ItineraryVisibility } from './types';

const base = (id: string) => `/itineraries/${encodeURIComponent(id)}`;
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export interface ItineraryDetailsInput {
  title: string;
  description?: string;
  countries: string[];
  startDate: string;
  visibility?: ItineraryVisibility;
}

export function createItinerary(input: ItineraryDetailsInput): Promise<Itinerary> {
  return apiClient<Itinerary>('/itineraries', json('POST', input));
}

/** ITN-01/ITN-20. An empty description string clears it. */
export function updateItinerary(id: string, input: Partial<ItineraryDetailsInput>): Promise<Itinerary> {
  return apiClient<Itinerary>(base(id), json('PATCH', input));
}

export function deleteItinerary(id: string): Promise<void> {
  return apiClient<void>(base(id), { method: 'DELETE' });
}

export interface DayInput {
  city: string;
  countryCode?: string;
  notes?: string;
}

/** ITN-05: appends, or inserts at `position` (1-based). */
export function addDay(id: string, input: DayInput & { position?: number }): Promise<Itinerary> {
  return apiClient<Itinerary>(`${base(id)}/days`, json('POST', input));
}

/** ITN-05: an empty notes string clears the notes. */
export function updateDay(id: string, dayId: string, input: Partial<DayInput>): Promise<Itinerary> {
  return apiClient<Itinerary>(`${base(id)}/days/${encodeURIComponent(dayId)}`, json('PATCH', input));
}

/** ITN-07: later days are renumbered and their dates move back. */
export function deleteDay(id: string, dayId: string): Promise<Itinerary> {
  return apiClient<Itinerary>(`${base(id)}/days/${encodeURIComponent(dayId)}`, { method: 'DELETE' });
}

/** ITN-08: every dayId, in the new order. */
export function reorderDays(id: string, dayIds: string[]): Promise<Itinerary> {
  return apiClient<Itinerary>(`${base(id)}/days/reorder`, json('PATCH', { dayIds }));
}
