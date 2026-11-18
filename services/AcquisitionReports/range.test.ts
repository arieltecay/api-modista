import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_RANGE_DAYS, ReportRangeError, resolveRange } from './range.js';

const TUCUMAN = 'America/Argentina/Tucuman';
const range = (from: string, to: string, timezone = TUCUMAN) => resolveRange({ from, to, timezone });

test('local calendar days become [from, to) UTC instants (Tucumán is UTC-3, no DST)', () => {
  const result = range('2026-11-10', '2026-11-16');
  assert.equal(result.from.toISOString(), '2026-11-10T03:00:00.000Z');
  assert.equal(result.toExclusive.toISOString(), '2026-11-17T03:00:00.000Z');
  assert.equal(result.timezone, TUCUMAN);
});

test('a single day spans exactly the local day', () => {
  const result = range('2026-11-18', '2026-11-18');
  assert.equal(result.toExclusive.getTime() - result.from.getTime(), 24 * 60 * 60 * 1000);
});

test('the range crosses month and year boundaries', () => {
  assert.equal(range('2026-11-01', '2026-11-30').toExclusive.toISOString(), '2026-12-01T03:00:00.000Z');
  assert.equal(range('2026-12-31', '2026-12-31').toExclusive.toISOString(), '2027-01-01T03:00:00.000Z');
  assert.equal(range('2028-02-29', '2028-02-29').toExclusive.toISOString(), '2028-03-01T03:00:00.000Z');
});

test('daylight saving days are 23 and 25 hours long', () => {
  const NY = 'America/New_York';
  const spring = range('2026-03-08', '2026-03-08', NY);
  assert.equal(spring.from.toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(spring.toExclusive.toISOString(), '2026-03-09T04:00:00.000Z');
  const fall = range('2026-11-01', '2026-11-01', NY);
  assert.equal(fall.from.toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(fall.toExclusive.toISOString(), '2026-11-02T05:00:00.000Z');
});

test('UTC and zones east of UTC work too', () => {
  assert.equal(range('2026-11-10', '2026-11-10', 'UTC').from.toISOString(), '2026-11-10T00:00:00.000Z');
  assert.equal(range('2026-11-10', '2026-11-10', 'Asia/Kolkata').from.toISOString(), '2026-11-09T18:30:00.000Z');
});

test('rejects invalid input with a ReportRangeError', () => {
  const invalid: Array<[string, () => unknown]> = [
    ['unknown timezone', () => range('2026-11-10', '2026-11-11', 'Mars/Olympus')],
    ['impossible date', () => range('2026-02-30', '2026-03-01')],
    ['malformed date', () => range('10/11/2026', '2026-11-11')],
    ['from after to', () => range('2026-11-12', '2026-11-11')],
    ['range too long', () => range('2026-01-01', '2026-06-30')],
    ['year below 1900 (Date.UTC would map 0050 to 1950)', () => range('0050-01-01', '0050-01-02')],
    ['year far in the future', () => range('3000-01-01', '3000-01-02')],
  ];
  for (const [label, run] of invalid) assert.throws(run, ReportRangeError, label);
});

test('the maximum range is accepted and one day more is not', () => {
  const day = (offset: number) => new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10);
  assert.doesNotThrow(() => range(day(0), day(MAX_RANGE_DAYS - 1)));
  assert.throws(() => range(day(0), day(MAX_RANGE_DAYS)), ReportRangeError);
});
