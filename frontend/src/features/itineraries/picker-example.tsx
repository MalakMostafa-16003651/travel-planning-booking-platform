'use client';

import { useState } from 'react';
import { ItineraryPicker } from './itinerary-picker';
import { ItineraryPreview } from './itinerary-preview';
import type { ItinerarySummary } from './types';

/** Gallery wiring: what Hicham's post editor does with the picker's output. */
export function ItineraryPickerExample() {
  const [value, setValue] = useState<string | null>(null);
  const [selected, setSelected] = useState<ItinerarySummary | null>(null);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ItineraryPicker value={value} onChange={(id, itinerary) => { setValue(id); setSelected(itinerary); }} />
      <div className="grid content-start gap-2">
        <p className="m-0 text-sm text-muted">Request field: <code>{JSON.stringify({ itineraryId: value })}</code></p>
        {value && <ItineraryPreview itinerary={selected} />}
      </div>
    </div>
  );
}
