import { BadRequestException } from '@nestjs/common';

export interface LocalDateTimeParts { year: number; month: number; day: number; hour: number; minute: number; second: number; }

function parseLocal(value: string): LocalDateTimeParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new BadRequestException('Date-time must use YYYY-MM-DDTHH:mm[:ss] local format without an offset');
  const parts = { year: +match[1], month: +match[2], day: +match[3], hour: +match[4], minute: +match[5], second: +(match[6] ?? 0) };
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  if (check.getUTCFullYear() !== parts.year || check.getUTCMonth() + 1 !== parts.month || check.getUTCDate() !== parts.day || check.getUTCHours() !== parts.hour || check.getUTCMinutes() !== parts.minute || check.getUTCSeconds() !== parts.second) {
    throw new BadRequestException('Invalid local date-time');
  }
  return parts;
}

function localPartsAt(instant: Date, timeZone: string): LocalDateTimeParts {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  } catch { throw new BadRequestException(`Unknown IANA timezone: ${timeZone}`); }
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

function same(a: LocalDateTimeParts, b: LocalDateTimeParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute && a.second === b.second;
}

/** Converts a wall-clock time at an airport to UTC; rejects DST gaps and repeated ambiguous times. */
export function localDateTimeToUtc(value: string, timeZone: string): Date {
  const wanted = parseLocal(value);
  const wallUtc = Date.UTC(wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute, wanted.second);
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 3) {
    const sample = new Date(wallUtc + hours * 60 * 60 * 1000);
    const local = localPartsAt(sample, timeZone);
    const represented = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    offsets.add(represented - sample.getTime());
  }
  const candidates = [...offsets].map((offset) => new Date(wallUtc - offset)).filter((candidate) => same(localPartsAt(candidate, timeZone), wanted));
  const unique = [...new Map(candidates.map((date) => [date.getTime(), date])).values()];
  if (unique.length === 0) throw new BadRequestException(`The local time ${value} does not exist in ${timeZone} because of a timezone transition`);
  if (unique.length > 1) throw new BadRequestException(`The local time ${value} is ambiguous in ${timeZone}; choose a non-ambiguous time`);
  return unique[0];
}

export function utcToLocalDateTime(instant: Date, timeZone: string): string {
  const p = localPartsAt(instant, timeZone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}`;
}

export function localDateBounds(date: string, timeZone: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Date must use YYYY-MM-DD');
  const [year, month, day] = date.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) throw new BadRequestException('Invalid date');
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const nextDate = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  return { start: localDateTimeToUtc(`${date}T00:00:00`, timeZone), end: localDateTimeToUtc(`${nextDate}T00:00:00`, timeZone) };
}
