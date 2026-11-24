import Link from 'next/link';
import { CalendarDays, Copy, EyeOff, MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatDateRange, formatTimestamp, pluralize, visibilityLabels } from './format';
import type { ItinerarySummary } from './types';

/**
 * Summary card used by ITN-03 (own list) and ITN-21 (public discovery). `showVisibility`
 * is for the owner's list; public cards never reveal anything beyond the public summary.
 */
export function ItineraryCard({ itinerary, href, countryNames = {}, showVisibility = false, showAuthor = false }: {
  itinerary: ItinerarySummary;
  href: string;
  countryNames?: Record<string, string>;
  showVisibility?: boolean;
  showAuthor?: boolean;
}) {
  const countries = itinerary.countries.map(code => countryNames[code] ?? regionName(code)).join(', ');
  return (
    <article className="grid gap-3 rounded-card border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="m-0 text-lg">
          <Link href={href} className="text-ink no-underline hover:underline">{itinerary.title}</Link>
        </h3>
        <div className="flex flex-wrap gap-2">
          {showVisibility && <Badge tone={itinerary.visibility === 'PUBLIC' ? 'info' : 'neutral'}>{visibilityLabels[itinerary.visibility]}</Badge>}
          {itinerary.isHidden && <Badge tone="warning"><EyeOff size={12} aria-hidden="true" className="mr-1" />Hidden by admin</Badge>}
        </div>
      </div>
      {showAuthor && itinerary.author && <p className="m-0 text-sm text-muted">By {itinerary.author.name}</p>}
      <dl className="m-0 grid gap-1 text-sm">
        <div className="flex items-center gap-2">
          <dt><MapPin size={16} aria-label="Countries" /></dt>
          <dd className="m-0">{countries}{itinerary.cities.length > 0 && <span className="text-muted"> · {itinerary.cities.join(', ')}</span>}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt><CalendarDays size={16} aria-label="Dates" /></dt>
          <dd className="m-0">{formatDateRange(itinerary.startDate, itinerary.endDate)} · {itinerary.dayCount === 0 ? 'No days yet' : pluralize(itinerary.dayCount, 'day')}</dd>
        </div>
        {itinerary.clonedFrom && (
          <div className="flex items-center gap-2">
            <dt><Copy size={16} aria-label="Cloned from" /></dt>
            <dd className="m-0 text-muted">Cloned from “{itinerary.clonedFrom.title}” by {itinerary.clonedFrom.authorName}</dd>
          </div>
        )}
      </dl>
      {showVisibility && <p className="m-0 text-xs text-muted">Updated {formatTimestamp(itinerary.updatedAt)}</p>}
    </article>
  );
}

/** Fallback when the caller has no catalog names: the platform's own English region name. */
function regionName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
