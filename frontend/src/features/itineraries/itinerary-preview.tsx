import { EmptyState } from '@/components/ui/empty-state';
import { ItineraryCard } from './itinerary-card';
import type { ItinerarySummary } from './types';

/**
 * Person 7 → Hicham (BLG-13) and the home page. Renders a summary exactly as the backend
 * returned it. The blog API sends `itinerary: null` both for posts that never had one and for
 * one that is no longer public, so post pages should render this only when there is one:
 * `{post.itinerary && <ItineraryPreview itinerary={post.itinerary} />}`.
 * Pass `null` only where you know an itinerary was attached (e.g. the editor after a 400):
 * it then shows "Itinerary not available" and nothing else about it.
 */
export function ItineraryPreview({ itinerary, countryNames }: { itinerary: ItinerarySummary | null; countryNames?: Record<string, string> }) {
  if (!itinerary) return <EmptyState title="Itinerary not available" description="The attached itinerary is no longer public." />;
  return <ItineraryCard itinerary={itinerary} href={`/explore/itineraries/${encodeURIComponent(itinerary.itineraryId)}`} countryNames={countryNames} showAuthor />;
}
