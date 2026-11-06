import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { localDateBounds, localDateTimeToUtc, utcToLocalDateTime } from '../src/flights/flight-time.util';

test('airport-local date-times convert to UTC and back', () => {
  const utc = localDateTimeToUtc('2026-12-10T14:00', 'Africa/Cairo');
  assert.equal(utc.toISOString(), '2026-12-10T12:00:00.000Z');
  assert.equal(utcToLocalDateTime(utc, 'Africa/Cairo'), '2026-12-10T14:00:00');
});

test('local date bounds use the airport timezone', () => {
  const bounds = localDateBounds('2026-12-10', 'Africa/Cairo');
  assert.equal(bounds.start.toISOString(), '2026-12-09T22:00:00.000Z');
  assert.equal(bounds.end.toISOString(), '2026-12-10T22:00:00.000Z');
});

test('nonexistent daylight-saving local times are rejected', () => {
  assert.throws(() => localDateTimeToUtc('2026-03-08T02:30', 'America/New_York'), BadRequestException);
});

test('ambiguous daylight-saving local times are rejected', () => {
  assert.throws(() => localDateTimeToUtc('2026-11-01T01:30', 'America/New_York'), BadRequestException);
});
