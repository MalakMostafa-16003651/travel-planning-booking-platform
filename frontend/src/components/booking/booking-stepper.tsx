import Link from 'next/link';
import { Check } from 'lucide-react';

export interface BookingStep {
  id: string;
  label: string;
  /** Only finished steps become links, so a traveler can go back without skipping ahead. */
  href?: string;
}

export interface BookingStepperProps {
  steps: BookingStep[];
  /** The id of the step the traveler is on. Steps before it are shown as finished. */
  current: string;
  label?: string;
}

/** Presentation only: shared by flight, hotel and checkout pages (Ismail, Osama, Hicham). */
export function BookingStepper({ steps, current, label = 'Booking progress' }: BookingStepperProps) {
  const index = Math.max(0, steps.findIndex(step => step.id === current));
  const active = steps[index];
  if (!active) return null;

  return (
    <nav aria-label={label}>
      <div className="grid gap-2 sm:hidden">
        <p className="m-0 text-sm text-muted">
          Step {index + 1} of {steps.length} · <span className="font-semibold text-ink">{active.label}</span>
        </p>
        <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
        </div>
      </div>
      <ol className="m-0 hidden list-none items-center gap-3 p-0 sm:flex">
        {steps.map((step, position) => {
          const done = position < index;
          const isCurrent = position === index;
          const text = (
            <span className={`text-sm ${isCurrent ? 'font-semibold text-ink' : 'text-muted'}`}>
              {step.label}
              {done && <span className="sr-only"> (completed)</span>}
            </span>
          );
          return (
            <li key={step.id} aria-current={isCurrent ? 'step' : undefined} className="flex min-w-0 flex-1 items-center gap-3 last:flex-none">
              <span
                aria-hidden="true"
                className={`grid size-8 shrink-0 place-items-center rounded-full border text-sm font-semibold ${
                  done ? 'border-primary bg-primary text-white' : isCurrent ? 'border-primary bg-card text-primary' : 'border-border bg-card text-muted'
                }`}
              >
                {done ? <Check size={16} /> : position + 1}
              </span>
              {done && step.href ? <Link href={step.href} className="inline-flex min-h-11 items-center">{text}</Link> : text}
              {position < steps.length - 1 && <span aria-hidden="true" className={`h-px min-w-4 flex-1 ${done ? 'bg-primary' : 'bg-border'}`} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
