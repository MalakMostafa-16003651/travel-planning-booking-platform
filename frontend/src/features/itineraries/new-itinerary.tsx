'use client';

import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { todayDateOnly } from '@/features/hotels/date-only';
import { createItinerary } from './api';
import { ItineraryForm } from './itinerary-form';

/** ITN-01: create, then continue straight into the day editor. */
export function NewItinerary() {
  const router = useRouter();
  return (
    <Card>
      <ItineraryForm
        mode="create"
        initial={{ title: '', description: '', countries: [], startDate: todayDateOnly(), visibility: 'PRIVATE' }}
        submitLabel="Create itinerary"
        onCancel={() => router.push('/itineraries')}
        onSubmit={async input => {
          const created = await createItinerary(input);
          router.push(`/itineraries/${encodeURIComponent(created.itineraryId)}/edit?created=1`);
          return created;
        }}
      />
    </Card>
  );
}
