import { EmptyState } from '@/components/ui/empty-state';
import { ItineraryCard } from './itinerary-card';
import type { ItinerarySummary } from './types';

/**
 * Person 7 → Hicham (BLG-13) and the home page. Pass the summary exactly as the backend
 * returned it (e.g. a post's `itinerary` field). `null` means it is no longer public, was
 * hidden or deleted, or its author was deactivated: nothing about it is shown.
 */
export function ItineraryPreview({ itinerary, countryNames }: { itinerary: ItinerarySummary | null; countryNames?: Record<string, string> }) {
  if (!itinerary) return <EmptyState title="Itinerary not available" description="The attached itinerary is no longer public." />;
  return <ItineraryCard itinerary={itinerary} href={`/explore/itineraries/${encodeURIComponent(itinerary.itineraryId)}`} countryNames={countryNames} showAuthor />;
}
