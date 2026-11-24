// Browser mutations for ITN-01/05/07/08/20. Every itinerary mutation returns the full,
// freshly recomputed ItineraryDto (day numbers, dates, city groups), so callers replace
// their state with the response instead of patching it locally.
import { apiClient, uploadFile } from '@/lib/api/client';
import type { BudgetCategory, BudgetSummary, Itinerary, ItineraryVisibility, TransportMode } from './types';

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

// ---------------------------------------------------------------- ITN-10/12 activities

export interface ActivityInput {
  title: string;
  description?: string;
  location?: string;
  attractionId?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  cost?: number | null;
  currency?: string | null;
}

export function addActivity(id: string, dayId: string, input: ActivityInput): Promise<Itinerary> {
  return apiClient<Itinerary>(`${base(id)}/days/${encodeURIComponent(dayId)}/activities`, json('POST', input));
}

/** Empty strings clear optional text; `cost: null` removes the cost and its currency. */
export function updateActivity(activityId: string, input: Partial<ActivityInput>): Promise<Itinerary> {
  return apiClient<Itinerary>(`/activities/${encodeURIComponent(activityId)}`, json('PATCH', input));
}

export function deleteActivity(activityId: string): Promise<Itinerary> {
  return apiClient<Itinerary>(`/activities/${encodeURIComponent(activityId)}`, { method: 'DELETE' });
}

/** ITN-12/GEN-08: multipart field `image`, JPEG/PNG up to 5 MB, five per activity. */
export function uploadActivityImage(activityId: string, file: File, onProgress?: (percent: number) => void): Promise<Itinerary> {
  return uploadFile<Itinerary>(`/activities/${encodeURIComponent(activityId)}/images`, 'image', file, onProgress);
}

export function deleteActivityImage(activityId: string, imageId: string): Promise<Itinerary> {
  return apiClient<Itinerary>(`/activities/${encodeURIComponent(activityId)}/images/${encodeURIComponent(imageId)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------- ITN-14 budget entries

export interface BudgetInput {
  category: BudgetCategory;
  amount: number;
  currency: string;
  description?: string;
}

export function addBudget(id: string, dayId: string, input: BudgetInput): Promise<Itinerary> {
  return apiClient<Itinerary>(`${base(id)}/days/${encodeURIComponent(dayId)}/budgets`, json('POST', input));
}

export function updateBudget(budgetId: string, input: Partial<BudgetInput>): Promise<Itinerary> {
  return apiClient<Itinerary>(`/budgets/${encodeURIComponent(budgetId)}`, json('PATCH', input));
}

export function deleteBudget(budgetId: string): Promise<Itinerary> {
  return apiClient<Itinerary>(`/budgets/${encodeURIComponent(budgetId)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------- ITN-16 intercity transport

export interface TransportInput {
  fromCity: string;
  toCity: string;
  mode: TransportMode;
  amount: number;
  currency: string;
  dayId: string;
  notes?: string;
}

export function addTransportCost(id: string, input: TransportInput): Promise<Itinerary> {
  return apiClient<Itinerary>(`${base(id)}/transport-costs`, json('POST', input));
}

export function updateTransportCost(transportCostId: string, input: Partial<TransportInput>): Promise<Itinerary> {
  return apiClient<Itinerary>(`/transport-costs/${encodeURIComponent(transportCostId)}`, json('PATCH', input));
}

export function deleteTransportCost(transportCostId: string): Promise<Itinerary> {
  return apiClient<Itinerary>(`/transport-costs/${encodeURIComponent(transportCostId)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------- ITN-14/18 budget summary

/** Without `currency` the backend uses the viewer's preferred currency (guests: itinerary currency). */
export function getBudgetSummary(id: string, currency?: string, signal?: AbortSignal): Promise<BudgetSummary> {
  const query = currency ? `?currency=${encodeURIComponent(currency)}` : '';
  return apiClient<BudgetSummary>(`${base(id)}/budget-summary${query}`, { signal });
}
