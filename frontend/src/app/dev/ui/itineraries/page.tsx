import { notFound } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { ItineraryPickerExample } from '@/features/itineraries/picker-example';
import { ItineraryPreview } from '@/features/itineraries/itinerary-preview';
import type { ItinerarySummary } from '@/features/itineraries/types';

export const dynamic = 'force-dynamic';

// Fictional example data for the presentational preview only; no real records.
const example: ItinerarySummary = {
  itineraryId: '000000000000000000000000', userId: '000000000000000000000001', author: { userId: '000000000000000000000001', name: 'Example Author' },
  title: 'Example: five days in Cairo', countries: ['EG'], cities: ['Cairo'], startDate: '2027-03-10', endDate: '2027-03-14', dayCount: 5,
  visibility: 'PUBLIC', currency: 'USD', createdAt: '2026-11-24T00:00:00Z', updatedAt: '2026-11-24T00:00:00Z',
};

/** Development-only examples of the Person 7 components for Hicham (BLG-13) and the home page. */
export default function ItineraryGalleryPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return (
    <div className="stack">
      <div><p className="eyebrow">Development only</p><h1 className="m-0">Itinerary components</h1></div>
      <Card className="stack">
        <h2 className="m-0">ItineraryPicker (sign in as a traveler)</h2>
        <ItineraryPickerExample />
      </Card>
      <Card className="stack">
        <h2 className="m-0">ItineraryPreview</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <ItineraryPreview itinerary={example} countryNames={{ EG: 'Egypt' }} />
          <ItineraryPreview itinerary={null} />
        </div>
      </Card>
    </div>
  );
}
