import assert from 'node:assert/strict';
import test from 'node:test';
import { reportQuerySchema } from './filters.js';

const base = { from: '2026-11-10', to: '2026-11-16' };

test('applies the documented defaults', () => {
  const parsed = reportQuerySchema.parse(base);
  assert.equal(parsed.timezone, 'America/Argentina/Tucuman');
  assert.equal(parsed.reportingMode, 'acquisition_cohort');
  assert.equal(parsed.outcomeWindowDays, 30);
  assert.equal(parsed.perspective, 'visit_touch');
});

test('coerces the outcome window from a query string and only accepts 7 or 30', () => {
  assert.equal(reportQuerySchema.parse({ ...base, outcomeWindowDays: '7' }).outcomeWindowDays, 7);
  assert.equal(reportQuerySchema.parse({ ...base, outcomeWindowDays: '30' }).outcomeWindowDays, 30);
  for (const value of ['0', '14', 'abc', '']) {
    assert.equal(reportQuerySchema.safeParse({ ...base, outcomeWindowDays: value }).success, false, value);
  }
});

test('accepts the three perspectives and both reporting modes only', () => {
  for (const perspective of ['visit_touch', 'first_touch', 'last_non_direct']) {
    assert.equal(reportQuerySchema.safeParse({ ...base, perspective }).success, true, perspective);
  }
  assert.equal(reportQuerySchema.safeParse({ ...base, perspective: 'linear' }).success, false);
  assert.equal(reportQuerySchema.safeParse({ ...base, reportingMode: 'rolling' }).success, false);
  assert.equal(reportQuerySchema.safeParse({ ...base, reportingMode: 'event_period' }).success, true);
});

test('requires a calendar range and bounds every filter', () => {
  assert.equal(reportQuerySchema.safeParse({}).success, false);
  assert.equal(reportQuerySchema.safeParse({ from: '2026-11-10' }).success, false);
  assert.equal(reportQuerySchema.safeParse({ ...base, from: 'yesterday' }).success, false);
  assert.equal(reportQuerySchema.safeParse({ ...base, campaign: 'x'.repeat(200) }).success, false);
  assert.equal(reportQuerySchema.safeParse({ ...base, device: 'fridge' }).success, false);
  const filtered = reportQuerySchema.parse({ ...base, channel: 'meta_paid', campaign: 'black', landing: 'curso-a', device: 'mobile' });
  assert.deepEqual([filtered.channel, filtered.campaign, filtered.landing, filtered.device], ['meta_paid', 'black', 'curso-a', 'mobile']);
});

test('drops unknown query keys instead of passing them to the database', () => {
  const parsed = reportQuerySchema.parse({ ...base, $where: '1', 'rawAttribution.campaign': 'x' }) as Record<string, unknown>;
  assert.equal('$where' in parsed, false);
  assert.equal('rawAttribution.campaign' in parsed, false);
});

test('the internal "unlinked" bucket cannot be requested as a channel filter', () => {
  assert.equal(reportQuerySchema.safeParse({ ...base, channel: 'unlinked' }).success, false);
  assert.equal(reportQuerySchema.safeParse({ ...base, channel: 'direct' }).success, true);
});
