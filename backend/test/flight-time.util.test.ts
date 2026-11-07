import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { localDateBounds, localDateTimeToUtc, utcToLocalDateTime } from '../src/flights/flight-time.util';

test('converts airport wall-clock time to UTC and back', () => {
  const utc = localDateTimeToUtc('2026-12-10T10:00', 'Africa/Cairo');
  assert.equal(utc.toISOString(), '2026-12-10T08:00:00.000Z');
  assert.equal(utcToLocalDateTime(utc, 'Africa/Cairo'), '2026-12-10T10:00:00');
});

test('local date bounds use the airport timezone', () => {
  const bounds = localDateBounds('2026-12-10', 'Africa/Cairo');
  assert.equal(bounds.start.toISOString(), '2026-12-09T22:00:00.000Z');
  assert.equal(bounds.end.toISOString(), '2026-12-10T22:00:00.000Z');
});

test('rejects a local time skipped by a DST jump', () => {
  assert.throws(() => localDateTimeToUtc('2027-03-14T02:30', 'America/New_York'));
});

test('rejects an ambiguous local time in a DST fallback', () => {
  assert.throws(() => localDateTimeToUtc('2026-11-01T01:30', 'America/New_York'));
});

test('date bounds are 24h on a normal day', () => {
  const { start, end } = localDateBounds('2026-12-10', 'Asia/Dubai');
  assert.equal(end.getTime() - start.getTime(), 24 * 3600 * 1000);
});

test('date bounds work on a day whose midnight does not exist (Havana, 2027-03-14)', () => {
  const { start, end } = localDateBounds('2027-03-14', 'America/Havana');
  assert.ok(end.getTime() > start.getTime());
  assert.ok(end.getTime() - start.getTime() <= 24 * 3600 * 1000);
});

test('date bounds are 23h / 25h on DST days in New York', () => {
  const spring = localDateBounds('2027-03-14', 'America/New_York');
  assert.equal((spring.end.getTime() - spring.start.getTime()) / 3600000, 23);
  const fall = localDateBounds('2026-11-01', 'America/New_York');
  assert.equal((fall.end.getTime() - fall.start.getTime()) / 3600000, 25);
});

test('invalid dates are rejected', () => {
  assert.throws(() => localDateBounds('2026-02-30', 'Africa/Cairo'));
});
