'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ItineraryPicker } from './itinerary-picker';
import { ItineraryPreview } from './itinerary-preview';
import type { ItinerarySummary } from './types';

/**
 * Gallery wiring: what Hicham's post editor does with the picker. `selected` keeps the saved
 * choice visible on other pages; the button simulates the blog API's 400 on `itineraryId`.
 */
export function ItineraryPickerExample() {
  const [value, setValue] = useState<string | null>(null);
  const [selected, setSelected] = useState<ItinerarySummary | null>(null);
  const [error, setError] = useState('');
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ItineraryPicker
        value={value}
        selected={selected}
        error={error}
        onChange={(id, itinerary) => { setValue(id); setSelected(itinerary); setError(''); }}
      />
      <div className="grid content-start gap-2">
        <p className="m-0 text-sm text-muted">Request field: <code>{JSON.stringify({ itineraryId: value })}</code></p>
        {selected && <ItineraryPreview itinerary={selected} />}
        <div>
          <Button variant="secondary" onClick={() => setError(`Attach one of your own public itineraries (simulated 400 at ${new Date().toLocaleTimeString()})`)}>
            Simulate a 400 on itineraryId
          </Button>
        </div>
      </div>
    </div>
  );
}
