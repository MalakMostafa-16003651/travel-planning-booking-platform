import type { ReactNode } from 'react';
import Link from 'next/link';
import { buttonClassName } from '@/components/ui/button';
import { Clock, MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { BudgetSummaryPanel } from './budget-summary';
import { PdfExport } from './pdf-export';
import { categoryLabels, formatDateRange, formatDayDate, money, pluralize, transportLabels, visibilityLabels } from './format';
import type { Activity, Itinerary } from './types';

/**
 * Read-only itinerary (ITN-03 owner view, ITN-21 public view). It renders only what the
 * backend returned for this viewer; linked bookings are owner-only and absent otherwise.
 */
export function ItineraryView({ itinerary, countryNames, isOwner, actions }: {
  itinerary: Itinerary;
  countryNames: Record<string, string>;
  isOwner: boolean;
  actions?: ReactNode;
}) {
  const daysById = new Map(itinerary.days.map(day => [day.dayId, day]));
  return (
    <article className="stack">
      <header className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid min-w-0 gap-2">
            <h1 className="m-0 [overflow-wrap:anywhere]">{itinerary.title}</h1>
            <p className="m-0 text-muted">
              {itinerary.countries.map(code => countryNames[code] ?? code).join(', ')}
              {' · '}{formatDateRange(itinerary.startDate, itinerary.endDate)}
              {' · '}{itinerary.dayCount === 0 ? 'No days yet' : pluralize(itinerary.dayCount, 'day')}
            </p>
            {itinerary.author && !isOwner && <p className="m-0 text-sm">By {itinerary.author.name}</p>}
            {itinerary.clonedFrom && <p className="m-0 text-sm text-muted [overflow-wrap:anywhere]">Cloned from “{itinerary.clonedFrom.title}” by {itinerary.clonedFrom.authorName}</p>}
            <div className="flex flex-wrap gap-2">
              {isOwner && <Badge tone={itinerary.visibility === 'PUBLIC' ? 'info' : 'neutral'}>{visibilityLabels[itinerary.visibility]}</Badge>}
              {itinerary.isHidden && <Badge tone="warning">Hidden by an administrator</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap items-start gap-3">
            {actions}
            {itinerary.days.length > 0 && <Link href={`/itineraries/${encodeURIComponent(itinerary.itineraryId)}/flights`} className={buttonClassName('secondary')}>Find flights to {itinerary.days[0].city}</Link>}
          </div>
        </div>
        <PdfExport itineraryId={itinerary.itineraryId} title={itinerary.title} />
        {itinerary.description && <p className="m-0 max-w-prose whitespace-pre-line [overflow-wrap:anywhere]">{itinerary.description}</p>}
      </header>

      {itinerary.days.length === 0 ? (
        <EmptyState title="No days planned yet" description={isOwner ? 'Open the editor to add the first day.' : 'The author has not added any days yet.'} />
      ) : (
        <ol className="m-0 grid list-none gap-8 p-0" aria-label="Days grouped by city">
          {itinerary.cityGroups.map(group => (
            <li key={`${group.firstDayNumber}-${group.city}`} className="grid gap-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
                <h2 className="m-0 text-xl">{group.city}{group.countryCode && <span className="text-base font-normal text-muted"> · {countryNames[group.countryCode] ?? group.countryCode}</span>}</h2>
                <p className="m-0 text-sm text-muted">
                  {pluralize(group.dayCount, 'day')} · {formatDateRange(group.startDate, group.endDate)}
                  {' · '}<Link href={`/itineraries/${encodeURIComponent(itinerary.itineraryId)}/hotels?dayId=${encodeURIComponent(group.dayIds[0])}`}>Find hotels</Link>
                </p>
              </div>
              <ol className="m-0 grid list-none gap-4 p-0">
                {group.dayIds.map(dayId => {
                  const day = daysById.get(dayId);
                  if (!day) return null;
                  return (
                    <li key={day.dayId}>
                      <Card className="grid gap-3 p-5">
                        <h3 className="m-0 text-lg">Day {day.dayNumber} · {formatDayDate(day.date)}</h3>
                        {day.notes && <p className="m-0 whitespace-pre-line">{day.notes}</p>}
                        {day.activities.length === 0
                          ? <p className="m-0 text-sm text-muted">No activities planned.</p>
                          : <ul className="m-0 grid list-none gap-3 p-0">{day.activities.map(activity => <ActivityItem key={activity.activityId} activity={activity} />)}</ul>}
                        {day.budgets.length > 0 && (
                          <div className="grid gap-1">
                            <h4 className="m-0 text-sm font-semibold text-ink">Budget entries</h4>
                            <ul className="m-0 grid list-none gap-1 p-0 text-sm">
                              {day.budgets.map(entry => (
                                <li key={entry.budgetId} className="flex flex-wrap justify-between gap-2">
                                  <span>{categoryLabels[entry.category]}{entry.description && <span className="text-muted"> · {entry.description}</span>}</span>
                                  <span>{money(entry.amount, entry.currency)}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </Card>
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
        </ol>
      )}

      {itinerary.transportCosts.length > 0 && (
        <section aria-labelledby="view-transport" className="grid gap-2">
          <h2 id="view-transport" className="m-0 text-xl">Intercity transport</h2>
          <ul className="m-0 grid list-none gap-2 p-0">
            {itinerary.transportCosts.map(cost => (
              <li key={cost.transportCostId} className="flex flex-wrap justify-between gap-2 rounded-control border border-border bg-card p-3 text-sm">
                <span>{cost.fromCity} → {cost.toCity} · {transportLabels[cost.mode]}{cost.dayNumber ? ` · Day ${cost.dayNumber}` : ''}</span>
                <span className="font-semibold">{money(cost.amount, cost.currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {itinerary.days.length > 0 && <BudgetSummaryPanel itineraryId={itinerary.itineraryId} refreshKey={itinerary.updatedAt} />}
    </article>
  );
}

function ActivityItem({ activity }: { activity: Activity }) {
  const time = activity.startTime ? (activity.endTime ? `${activity.startTime}–${activity.endTime}` : activity.startTime) : null;
  return (
    <li className="grid gap-1 rounded-control border border-border p-3">
      <p className="m-0 font-semibold text-ink [overflow-wrap:anywhere]">{activity.title}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {time && <span className="inline-flex items-center gap-1"><Clock size={14} aria-hidden="true" />{time}</span>}
        {activity.location && <span className="inline-flex items-center gap-1"><MapPin size={14} aria-hidden="true" />{activity.location}</span>}
        {activity.cost !== undefined && activity.currency && <span>{money(activity.cost, activity.currency)}</span>}
      </div>
      {activity.description && <p className="m-0 whitespace-pre-line text-sm">{activity.description}</p>}
      {activity.images.length > 0 && (
        <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-5">
          {activity.images.map((image, index) => (
            // eslint-disable-next-line @next/next/no-img-element -- served by our own API with the itinerary's visibility rules
            <img key={image.imageId} src={image.url} alt={`${activity.title}, photo ${index + 1}`} loading="lazy" className="aspect-[4/3] w-full rounded-control border border-border object-cover" />
          ))}
        </div>
      )}
    </li>
  );
}
