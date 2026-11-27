import { notFound } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { ReportAction, type ReportTargetType } from '@/features/reports';

export const dynamic = 'force-dynamic';

// Development preview only. The IDs are placeholders, so a real backend answers "no longer available";
// sign in as a traveler and use real IDs from your own data to send an actual report.
const examples: { type: ReportTargetType; label: string; id: string }[] = [
  { type: 'POST', label: 'A blog post', id: '000000000000000000000001' },
  { type: 'COMMENT', label: 'A comment', id: '000000000000000000000002' },
  { type: 'REVIEW', label: 'A hotel review', id: '000000000000000000000003' },
  { type: 'ITINERARY', label: 'A public itinerary', id: '000000000000000000000004' },
];

export default function ReportActionGalleryPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return (
    <div className="page-container page-content stack">
      <div>
        <p className="eyebrow">Development only</p>
        <h1 className="section-heading">ReportAction (GEN-09)</h1>
        <p className="muted">Guests are sent to sign in; travelers get the reason form; administrators and moderators see nothing. See docs/m2/REPORTS.md.</p>
      </div>
      <div className="gallery-grid">
        {examples.map(example => (
          <Card key={example.type} className="flex items-center justify-between gap-3">
            <span className="font-semibold text-ink">{example.label}</span>
            <ReportAction targetType={example.type} targetId={example.id} />
          </Card>
        ))}
      </div>
    </div>
  );
}
