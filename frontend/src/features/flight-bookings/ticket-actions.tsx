'use client';

import { useState } from 'react';
import { CalendarPlus, Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';
import { RequestError } from './request-error';
import type { BookingSegment } from './types';

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // The click only starts the download, so give the browser time to read the file.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** FLT-23. The shared client parses JSON, so this reads the PDF through the same /api proxy instead. */
async function fetchTicket(bookingId: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(`/api/flight-bookings/${bookingId}/e-ticket`, { credentials: 'include', cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'Unable to connect. Check your connection and try again.');
  }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('session-expired'));
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new ApiError(response.status, body?.message ?? 'The e-ticket could not be downloaded. Please try again.');
  }
  return response.blob();
}

function icsTime(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsText(value: string): string {
  return value.replace(/([\\;,])/g, '\\$1').replace(/\r?\n/g, '\\n');
}

/** One event per flight. Times are UTC instants, which calendars show in the reader's own zone. */
export function tripCalendar(bookingReference: string, segments: BookingSegment[], createdAt: string): string {
  const events = segments.flatMap((segment, index) => [
    'BEGIN:VEVENT',
    `UID:${bookingReference}-${index}@travel-planning`,
    `DTSTAMP:${icsTime(createdAt)}`,
    `DTSTART:${icsTime(segment.departureAt)}`,
    `DTEND:${icsTime(segment.arrivalAt)}`,
    `SUMMARY:${icsText(`Flight ${segment.flightNumber}: ${segment.departureAirportCode} to ${segment.arrivalAirportCode}`)}`,
    `DESCRIPTION:${icsText(`Booking reference ${bookingReference}`)}`,
    'END:VEVENT',
  ]);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Travel Planning and Booking//Flight bookings//EN', ...events, 'END:VCALENDAR', ''].join('\r\n');
}

export function TicketActions({ bookingId, bookingReference, segments, createdAt }: {
  bookingId: string;
  bookingReference: string;
  segments: BookingSegment[];
  createdAt: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      save(await fetchTicket(bookingId), `e-ticket-${bookingReference}.pdf`);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-3">
        <Button disabled={busy} onClick={download}><Download size={16} aria-hidden="true" />{busy ? 'Preparing…' : 'Download e-ticket (PDF)'}</Button>
        <Button
          variant="secondary"
          onClick={() => save(new Blob([tripCalendar(bookingReference, segments, createdAt)], { type: 'text/calendar' }), `flights-${bookingReference}.ics`)}
        >
          <CalendarPlus size={16} aria-hidden="true" />Add to calendar
        </Button>
      </div>
      {error != null && <RequestError error={error} title="Your e-ticket could not be downloaded" />}
    </div>
  );
}

export function CopyReference({ reference }: { reference: string }) {
  const [message, setMessage] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(reference);
      setMessage('Copied');
    } catch {
      setMessage('Select the reference to copy it');
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="secondary" onClick={copy} aria-label={`Copy booking reference ${reference}`}><Copy size={16} aria-hidden="true" />Copy</Button>
      <span role="status" className="text-sm text-muted">{message}</span>
    </span>
  );
}
