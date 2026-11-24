'use client';

import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';

export interface HoldTimerProps {
  /** holdExpiresAt from the backend. */
  expiresAt: string;
  /**
   * The server's time when the page was rendered. The countdown runs from the difference between the
   * two, so a wrong clock on the traveler's device cannot lengthen or shorten the hold they see.
   */
  serverNow: string;
  /** Called once. Re-read the booking here: the countdown itself never releases stock or confirms anything. */
  onExpire?: () => void;
  label?: string;
  expiredLabel?: string;
}

const WARNING_SECONDS = 120;
const ANNOUNCED_SECONDS = [300, 60];

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Presentation only: shared by flight holds, hotel holds and checkout (Ismail, Osama, Hicham). */
export function HoldTimer({ expiresAt, serverNow, onExpire, label = 'Held for you', expiredLabel = 'This hold has ended' }: HoldTimerProps) {
  const initialMs = Math.max(0, new Date(expiresAt).getTime() - new Date(serverNow).getTime());
  const [seconds, setSeconds] = useState(() => Math.ceil(initialMs / 1000));
  const [announcement, setAnnouncement] = useState('');
  const expire = useRef(onExpire);
  const notifiedFor = useRef('');

  useEffect(() => { expire.current = onExpire; }, [onExpire]);

  useEffect(() => {
    const startedMonotonic = performance.now();
    const startedWall = Date.now();
    const announced = new Set(ANNOUNCED_SECONDS.filter(mark => initialMs / 1000 <= mark));
    let timer: number | undefined;
    let finished = false;

    function tick() {
      if (finished) return;
      // The monotonic clock can pause while a laptop sleeps; the wall clock covers that case.
      const elapsed = Math.max(performance.now() - startedMonotonic, Date.now() - startedWall);
      const left = Math.max(0, Math.ceil((initialMs - elapsed) / 1000));
      setSeconds(left);
      for (const mark of ANNOUNCED_SECONDS) {
        if (left > 0 && left <= mark && !announced.has(mark)) {
          announced.add(mark);
          setAnnouncement(`${mark / 60} ${mark === 60 ? 'minute' : 'minutes'} left to pay.`);
        }
      }
      if (left === 0) {
        finished = true;
        window.clearInterval(timer);
        setAnnouncement(expiredLabel);
        // Re-rendering with a newer serverNow restarts this effect; report each deadline only once.
        if (notifiedFor.current !== expiresAt) {
          notifiedFor.current = expiresAt;
          expire.current?.();
        }
      }
    }

    timer = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    tick();
    return () => {
      finished = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [initialMs, expiresAt, expiredLabel]);

  const ended = seconds === 0;
  const urgent = !ended && seconds <= WARNING_SECONDS;
  return (
    <div className={`flex items-center gap-3 rounded-control border px-4 py-3 ${ended ? 'border-danger bg-card' : urgent ? 'border-sand bg-sand/20' : 'border-border bg-canvas'}`}>
      <Clock size={20} aria-hidden="true" className={ended ? 'text-danger' : 'text-ink'} />
      {ended ? (
        <p className="m-0 text-sm font-semibold text-danger">{expiredLabel}</p>
      ) : (
        <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-sm text-body">
          {label}
          <span role="timer" aria-live="off" className="font-heading text-xl font-bold tabular-nums text-ink">{clock(seconds)}</span>
          {urgent && <span className="font-semibold text-ink">Almost out of time</span>}
        </p>
      )}
      <span role="status" className="sr-only">{announcement}</span>
    </div>
  );
}
