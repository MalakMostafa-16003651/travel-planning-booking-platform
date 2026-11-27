'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Download, Printer } from 'lucide-react';
import { Button, buttonClassName } from '@/components/ui/button';
import { loginHref } from '@/config/routes';
import { useSession } from '@/features/auth/session-provider';

type State = { kind: 'idle' } | { kind: 'working'; action: 'download' | 'print'; received: number; total: number | null } | { kind: 'done'; message: string } | { kind: 'error'; message: string };

async function readError(response: Response): Promise<string> {
  if (response.status === 401) {
    window.dispatchEvent(new Event('session-expired'));
    return 'Your session has ended. Sign in again to export this itinerary.';
  }
  if (response.status === 404) return 'This itinerary is no longer available to you, so it cannot be exported.';
  const body = await response.json().catch(() => null) as { message?: string } | null;
  return body?.message || 'The PDF could not be created. Please try again.';
}

function filenameOf(response: Response, fallback: string): string {
  const match = /filename="?([^";]+)"?/i.exec(response.headers.get('content-disposition') ?? '');
  return match?.[1] ?? fallback;
}

/**
 * ITN-28 (bonus): authorized PDF export via the existing GET /api/itineraries/:id/pdf, which
 * applies the same visibility rules as viewing (owner, or a public itinerary for any signed-in
 * user). Shows download progress; printing loads the same PDF into a hidden frame.
 */
export function PdfExport({ itineraryId, title }: { itineraryId: string; title: string }) {
  const { user, loading } = useSession();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const frame = useRef<HTMLIFrameElement>(null);
  const working = state.kind === 'working';

  if (loading) return null;
  if (!user) return <Link href={loginHref(typeof window === 'undefined' ? null : window.location.pathname)} className={buttonClassName('secondary')}>Sign in to download PDF</Link>;

  async function fetchPdf(action: 'download' | 'print'): Promise<{ blob: Blob; filename: string } | null> {
    setState({ kind: 'working', action, received: 0, total: null });
    let response: Response;
    try {
      response = await fetch(`/api/itineraries/${encodeURIComponent(itineraryId)}/pdf`, { credentials: 'include', cache: 'no-store' });
    } catch {
      setState({ kind: 'error', message: 'Unable to connect. Check your connection and try again.' });
      return null;
    }
    if (!response.ok || !response.body) {
      setState({ kind: 'error', message: await readError(response) });
      return null;
    }
    const total = Number(response.headers.get('content-length')) || null;
    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      setState({ kind: 'working', action, received, total });
    }
    return { blob: new Blob(chunks, { type: 'application/pdf' }), filename: filenameOf(response, `itinerary-${itineraryId}.pdf`) };
  }

  async function download() {
    if (working) return;
    const pdf = await fetchPdf('download');
    if (!pdf) return;
    const url = URL.createObjectURL(pdf.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = pdf.filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setState({ kind: 'done', message: `Downloaded ${pdf.filename}.` });
  }

  async function print() {
    if (working) return;
    const pdf = await fetchPdf('print');
    if (!pdf || !frame.current) return;
    const url = URL.createObjectURL(pdf.blob);
    frame.current.onload = () => {
      try {
        frame.current?.contentWindow?.print();
        setState({ kind: 'done', message: 'Print dialog opened.' });
      } catch {
        setState({ kind: 'error', message: 'Printing is blocked here. Download the PDF and print it instead.' });
      }
    };
    frame.current.src = url;
  }

  const progress = state.kind === 'working'
    ? state.total ? `${Math.round((state.received / state.total) * 100)}%` : `${Math.max(1, Math.round(state.received / 1024))} KB`
    : '';

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={download} disabled={working} aria-label={`Download “${title}” as PDF`}>
          <Download size={16} aria-hidden="true" />{state.kind === 'working' && state.action === 'download' ? `Preparing… ${progress}` : 'Download PDF'}
        </Button>
        <Button variant="secondary" onClick={print} disabled={working}>
          <Printer size={16} aria-hidden="true" />{state.kind === 'working' && state.action === 'print' ? `Preparing… ${progress}` : 'Print'}
        </Button>
      </div>
      <p role="status" className={`m-0 text-sm ${state.kind === 'error' ? 'text-danger' : 'text-muted'}`}>
        {state.kind === 'done' || state.kind === 'error' ? state.message : ''}
      </p>
      <iframe ref={frame} title="Itinerary PDF for printing" className="hidden" />
    </div>
  );
}
