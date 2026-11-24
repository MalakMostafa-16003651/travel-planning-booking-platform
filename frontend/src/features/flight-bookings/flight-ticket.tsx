import type { ReactNode } from 'react';
import { Plane } from 'lucide-react';
import { cabinName, duration, localClock, localDay, zoneName } from './format';
import styles from './ticket.module.css';
import type { Airport, BookingSegment, OfferedCabin, OfferedFlight } from './types';

type TicketSegment = Pick<BookingSegment,
  'flightNumber' | 'cabinClass' | 'departureAirportCode' | 'arrivalAirportCode' | 'departureAt' | 'arrivalAt' | 'departureTimeZone' | 'arrivalTimeZone'>;

/** A flight from Person 3's public details, in the shape a booking stores it. */
export function segmentFromOffer(flight: OfferedFlight, cabin: OfferedCabin): TicketSegment {
  return {
    flightNumber: flight.flightNumber,
    cabinClass: cabin.cabinClass,
    departureAirportCode: flight.departureAirport.code,
    arrivalAirportCode: flight.arrivalAirport.code,
    departureAt: flight.departureAtUtc,
    arrivalAt: flight.arrivalAtUtc,
    departureTimeZone: flight.departureAirport.timeZone,
    arrivalTimeZone: flight.arrivalAirport.timeZone,
  };
}

function Stop({ code, city, at, timeZone, align }: { code: string; city?: string; at: string; timeZone: string; align: 'left' | 'right' }) {
  return (
    <div className={`min-w-0 ${align === 'right' ? 'text-right' : ''}`}>
      <p className="m-0 font-heading text-3xl font-bold leading-none tracking-tight text-ink sm:text-4xl">{code}</p>
      {city && <p className="m-0 mt-1 truncate text-sm text-muted">{city}</p>}
      <p className="m-0 mt-3 text-lg font-semibold leading-tight tabular-nums text-ink">
        <time dateTime={at}>{localClock(at, timeZone)}</time>
      </p>
      <p className="m-0 text-sm text-muted">{localDay(at, timeZone)}</p>
      <p className="m-0 text-xs text-muted">{zoneName(at, timeZone)}</p>
    </div>
  );
}

/** One flight of a trip, with each end in its own airport's time (GEN-06). */
export function FlightTicket({ segment, label, airports = {}, airlineName, children }: {
  segment: TicketSegment;
  /** "Outbound" or "Return". */
  label?: string;
  airports?: Record<string, Airport>;
  airlineName?: string;
  /** Extra lines in the stub, such as the fare or seats. */
  children?: ReactNode;
}) {
  const from = airports[segment.departureAirportCode];
  const to = airports[segment.arrivalAirportCode];
  return (
    <article
      className={styles.ticket}
      aria-label={`${label ? `${label} flight` : 'Flight'} ${segment.flightNumber}, ${from?.city ?? segment.departureAirportCode} to ${to?.city ?? segment.arrivalAirportCode}`}
    >
      <div className={styles.route}>
        {label && <p className="m-0 mb-4 text-xs font-semibold uppercase tracking-widest text-primary">{label}</p>}
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(56px,1fr)_minmax(0,1fr)] items-start gap-3 sm:gap-6">
          <Stop code={segment.departureAirportCode} city={from?.city} at={segment.departureAt} timeZone={segment.departureTimeZone} align="left" />
          <div className="pt-3 text-center">
            <div className="relative">
              <div className={styles.line} />
              <span className="absolute left-1/2 top-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-card text-primary">
                <Plane size={18} aria-hidden="true" className="rotate-45" />
              </span>
            </div>
            <p className="m-0 mt-5 text-xs text-muted">{duration(segment.departureAt, segment.arrivalAt)}</p>
          </div>
          <Stop code={segment.arrivalAirportCode} city={to?.city} at={segment.arrivalAt} timeZone={segment.arrivalTimeZone} align="right" />
        </div>
      </div>
      <div className={styles.stub}>
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-1">
          <div>
            <dt className="text-xs text-muted">Flight</dt>
            <dd className="m-0 font-heading font-bold text-ink">{segment.flightNumber}</dd>
            {airlineName && <dd className="m-0 text-xs text-muted">{airlineName}</dd>}
          </div>
          <div>
            <dt className="text-xs text-muted">Cabin</dt>
            <dd className="m-0 font-semibold text-ink">{cabinName(segment.cabinClass)}</dd>
          </div>
          {children}
        </dl>
      </div>
    </article>
  );
}
