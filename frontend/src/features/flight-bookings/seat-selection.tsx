'use client';

import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/loading-state';
import { ApiError, apiClient } from '@/lib/api/client';
import { RequestError } from './request-error';
import type { FlightBooking, PassengerType, SeatChoice, SeatMap, SeatMapSegment } from './types';

/**
 * The props Gamila proposed for her SeatSelector in issue #131. It is presentation only and covers one
 * flight. This section owns GET seat-map and PUT seats, because PUT replaces the choices for every future
 * flight of the booking: a selector saving only its own flight would erase the other one.
 */
export interface SeatSelectorProps {
  bookingId: string;
  segment: SeatMapSegment;
  /** Infants never appear here: they have no seat. */
  passengers: { passengerId: string; name: string; type: PassengerType }[];
  value: { passengerId: string; seatNumber: number }[];
  onChange: (value: { passengerId: string; seatNumber: number }[]) => void;
  onRetry: () => void;
  disabled?: boolean;
}

export function SeatSelection({ booking, Selector }: { booking: FlightBooking; Selector: ComponentType<SeatSelectorProps> }) {
  const router = useRouter();
  const id = booking.flightBookingId;
  const [map, setMap] = useState<SeatMap | null>(null);
  const [draft, setDraft] = useState<SeatChoice[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const loaded = await apiClient<SeatMap>(`/flight-bookings/${id}/seat-map`, { signal });
      if (signal?.aborted) return;
      setMap(loaded);
      setDraft(loaded.selections);
    } catch (cause) {
      if (!signal?.aborted) setError(cause);
    }
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function retry() {
    setError(null);
    void load();
  }

  async function save() {
    if (!map || saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    const modifiable = new Set(map.segments.filter(segment => segment.modifiable).map(segment => segment.flightId));
    try {
      const updated = await apiClient<SeatMap>(`/flight-bookings/${id}/seats`, {
        method: 'PUT',
        body: JSON.stringify({ selections: draft.filter(choice => modifiable.has(choice.flightId)) }),
      });
      setMap(updated);
      setDraft(updated.selections);
      setSaved(true);
      router.refresh();
    } catch (cause) {
      setError(cause);
      // Someone else took a seat: show the current map again so the traveler can choose another.
      if (cause instanceof ApiError && cause.status === 409) await load();
    } finally {
      setSaving(false);
    }
  }

  if (!map) return error != null
    ? <div className="grid gap-3"><RequestError error={error} title="The seat map could not be loaded" /><div><Button variant="secondary" onClick={retry}>Try again</Button></div></div>
    : <LoadingState label="Loading seats…" />;

  const passengers = booking.passengers.filter(({ type }) => type !== 'INFANT')
    .map(({ passengerId, fullName, type }) => ({ passengerId, name: fullName, type }));

  return (
    <div className="grid gap-5">
      {error != null && <RequestError error={error} title="Your seats were not saved" />}
      {map.segments.map(segment => (
        <Selector
          key={segment.flightId}
          bookingId={id}
          segment={segment}
          passengers={passengers}
          value={draft.filter(choice => choice.flightId === segment.flightId).map(({ passengerId, seatNumber }) => ({ passengerId, seatNumber }))}
          onChange={value => {
            setSaved(false);
            setDraft(current => [
              ...current.filter(choice => choice.flightId !== segment.flightId),
              ...value.map(choice => ({ flightId: segment.flightId, ...choice })),
            ]);
          }}
          onRetry={retry}
          disabled={saving || !segment.modifiable}
        />
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={saving || !map.segments.some(segment => segment.modifiable)} onClick={save}>{saving ? 'Saving seats…' : 'Save seats'}</Button>
        <span role="status" className="text-sm text-muted">{saved ? 'Seats saved.' : ''}</span>
      </div>
    </div>
  );
}
