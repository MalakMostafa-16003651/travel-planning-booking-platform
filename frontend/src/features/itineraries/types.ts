// Wire types for the itinerary API. Source of truth:
// backend/src/itineraries/dto/itinerary-response.dto.ts, budget-summary.dto.ts, linked-booking.dto.ts.
// Itinerary amounts are MAJOR units in the stated currency (docs/m2/ROUTES_AND_HANDOFFS.md).

export type ItineraryVisibility = 'PRIVATE' | 'PUBLIC';
export type BudgetCategory = 'FOOD' | 'ACCOMMODATION' | 'ACTIVITIES' | 'LOCAL_TRANSPORT';
export type TransportMode = 'FLIGHT' | 'TRAIN' | 'BUS' | 'CAR' | 'FERRY' | 'OTHER';

export interface ActivityImage {
  imageId: string;
  /** API-relative, e.g. /api/activities/:id/images/:imageId. Same visibility as the itinerary. */
  url: string;
  contentType: string;
  size: number;
}

export interface Activity {
  activityId: string;
  dayId: string;
  title: string;
  description?: string;
  location?: string;
  attractionId?: string;
  startTime?: string;
  endTime?: string;
  cost?: number;
  currency?: string;
  images: ActivityImage[];
}

export interface BudgetEntry {
  budgetId: string;
  dayId: string;
  category: BudgetCategory;
  amount: number;
  currency: string;
  description?: string;
}

export interface TransportCost {
  transportCostId: string;
  fromCity: string;
  toCity: string;
  mode: TransportMode;
  amount: number;
  currency: string;
  dayId?: string;
  dayNumber?: number;
  date?: string;
  notes?: string;
}

export interface ItineraryDay {
  dayId: string;
  dayNumber: number;
  /** YYYY-MM-DD derived by the backend from startDate and the day order. */
  date: string;
  city: string;
  countryCode?: string;
  notes?: string;
  activities: Activity[];
  budgets: BudgetEntry[];
}

export interface CityGroup {
  city: string;
  countryCode?: string;
  firstDayNumber: number;
  lastDayNumber: number;
  startDate: string;
  endDate: string;
  dayCount: number;
  dayIds: string[];
}

export interface ClonedFrom {
  itineraryId: string;
  userId: string;
  authorName: string;
  title: string;
  clonedAt: string;
}

export interface ItinerarySummary {
  itineraryId: string;
  userId: string;
  author?: { userId: string; name: string };
  title: string;
  description?: string;
  countries: string[];
  cities: string[];
  startDate: string;
  endDate?: string;
  dayCount: number;
  visibility: ItineraryVisibility;
  currency: string;
  clonedFrom?: ClonedFrom;
  publishedAt?: string | null;
  isHidden?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LinkedBooking {
  linkedBookingId: string;
  type: 'FLIGHT' | 'HOTEL';
  bookingId: string;
  dayId: string;
  linkedAt: string;
  status: string | null;
  countsInBudget: boolean;
  label?: string;
  bookingReference?: string;
  amount?: number;
  currency?: string;
  startDate?: string;
  endDate?: string;
  matchesDay?: boolean;
}

export interface Itinerary extends ItinerarySummary {
  days: ItineraryDay[];
  cityGroups: CityGroup[];
  transportCosts: TransportCost[];
  /** ITN-27: only present in the owner's own responses. */
  linkedBookings?: LinkedBooking[];
}

export interface ItineraryPage {
  items: ItinerarySummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Limits enforced by the backend DTOs/rules; mirrored only to give earlier inline feedback. */
export const ITINERARY_LIMITS = {
  title: 100,
  description: 2000,
  countries: 30,
  days: 60,
  dayCity: 100,
  dayNotes: 2000,
} as const;

export type CategoryTotals = Record<BudgetCategory, number>;

/** ITN-14/ITN-18: every converted figure is in `currency`, major units, rounded to 2 decimals. */
export interface BudgetSummary {
  itineraryId: string;
  currency: string;
  totals: { categories: CategoryTotals; daily: number; transport: number; grandTotal: number };
  byDay: { dayId: string; dayNumber: number; date: string; city: string; categories: CategoryTotals; transport: number; total: number }[];
  byCity: { city: string; countryCode?: string; firstDayNumber: number; lastDayNumber: number; total: number }[];
  transportCosts: { transportCostId: string; fromCity: string; toCity: string; mode: TransportMode; amount: number; currency: string; convertedAmount: number }[];
  linkedBookings?: { linkedBookingId: string; type: 'FLIGHT' | 'HOTEL'; dayId: string; status: string | null; countsInBudget: boolean; label?: string; amount?: number; currency?: string; convertedAmount: number }[];
  originalTotals: { currency: string; amount: number }[];
  rateDate: string | null;
  ratesStale: boolean;
}

export const BUDGET_CATEGORIES: BudgetCategory[] = ['FOOD', 'ACCOMMODATION', 'ACTIVITIES', 'LOCAL_TRANSPORT'];
export const TRANSPORT_MODES: TransportMode[] = ['FLIGHT', 'TRAIN', 'BUS', 'CAR', 'FERRY', 'OTHER'];
export const MAX_ACTIVITY_IMAGES = 5;
