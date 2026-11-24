import { notFound } from 'next/navigation';
import { BookingLifecycle, BookingStatusBadge, type BookingStatus } from '@/components/booking/booking-status';
import { BookingStepper } from '@/components/booking/booking-stepper';
import { HoldTimer } from '@/components/booking/hold-timer';
import { Card } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

const steps = [{ id: 'choose', label: 'Choose', href: '/dev/ui/booking' }, { id: 'travelers', label: 'Travelers' }, { id: 'review', label: 'Review' }, { id: 'payment', label: 'Payment' }];
const statuses: BookingStatus[] = ['PENDING', 'CONFIRMED', 'COMPLETED', 'EXPIRED', 'CANCELLED'];

/** Development-only examples of the shared booking components, for Osama and Hicham. */
export default function BookingGalleryPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  const now = Date.now();
  const at = (seconds: number) => new Date(now + seconds * 1000).toISOString();
  return (
    <div className="stack">
      <div><p className="eyebrow">Development only</p><h1 className="m-0">Booking components</h1></div>
      <Card className="stack">
        <h2 className="m-0">BookingStepper</h2>
        {steps.map(step => <BookingStepper key={step.id} steps={steps} current={step.id} label={`Example at ${step.label}`} />)}
      </Card>
      <Card className="stack">
        <h2 className="m-0">HoldTimer</h2>
        <HoldTimer expiresAt={at(600)} serverNow={at(0)} />
        <HoldTimer expiresAt={at(65)} serverNow={at(0)} label="Your rooms are held for" />
        <HoldTimer expiresAt={at(-1)} serverNow={at(0)} />
      </Card>
      <Card className="stack">
        <h2 className="m-0">Status and lifecycle (GEN-11)</h2>
        {statuses.map(status => (
          <div key={status} className="flex flex-wrap items-center gap-4"><BookingStatusBadge status={status} /><BookingLifecycle status={status} /></div>
        ))}
      </Card>
    </div>
  );
}
