import { Badge, type BadgeTone } from '@/components/ui/badge';

/** backend/src/common/enums/booking-status.enum.ts (GEN-11), shared by flights and hotels. */
export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED';

const meta: Record<BookingStatus, { label: string; tone: BadgeTone }> = {
  PENDING: { label: 'Payment pending', tone: 'warning' },
  CONFIRMED: { label: 'Confirmed', tone: 'success' },
  COMPLETED: { label: 'Completed', tone: 'info' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
};

/** A hold whose time is up is already unusable, even before the server's sweep marks it EXPIRED. */
export function effectiveStatus(status: BookingStatus, holdExpiresAt: string | undefined, now: string): BookingStatus {
  if (status !== 'PENDING') return status;
  return !holdExpiresAt || new Date(holdExpiresAt) <= new Date(now) ? 'EXPIRED' : 'PENDING';
}

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const { label, tone } = meta[status];
  return <Badge tone={tone}>{label}</Badge>;
}

const path: { status: BookingStatus; label: string }[] = [
  { status: 'PENDING', label: 'Payment pending' },
  { status: 'CONFIRMED', label: 'Confirmed' },
  { status: 'COMPLETED', label: 'Completed' },
];

/** GEN-11 as the traveler sees it. Expired and Cancelled end the path instead of continuing it. */
export function BookingLifecycle({ status }: { status: BookingStatus }) {
  const ended = status === 'EXPIRED' || status === 'CANCELLED';
  const steps = status === 'EXPIRED' ? [path[0], { status, label: 'Expired' }]
    : status === 'CANCELLED' ? [path[0], path[1], { status, label: 'Cancelled' }]
      : path;
  const reached = steps.findIndex(step => step.status === status);

  return (
    <ol aria-label="Booking status" className="m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-2 p-0">
      {steps.map((step, index) => {
        const current = index === reached;
        const dot = current && ended ? 'border-danger bg-danger' : index <= reached ? 'border-primary bg-primary' : 'border-border bg-card';
        return (
          <li key={step.status} aria-current={current ? 'step' : undefined} className="flex items-center gap-2 text-sm">
            <span aria-hidden="true" className={`size-2.5 rounded-full border ${dot}`} />
            <span className={current ? 'font-semibold text-ink' : 'text-muted'}>{step.label}</span>
            {index < steps.length - 1 && <span aria-hidden="true" className={`ml-1 h-px w-6 ${index < reached ? 'bg-primary' : 'bg-border'}`} />}
          </li>
        );
      })}
    </ol>
  );
}
