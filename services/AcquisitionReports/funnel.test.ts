import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';
import AcquisitionEvent from '../../models/AcquisitionEvent/index.js';
import AcquisitionVisit from '../../models/AcquisitionVisit/index.js';
import { acquisitionEvent, visit } from '../../utils/testing/acquisitionFixtures.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { funnelQuerySchema } from './filters.js';
import { getFunnelReport } from './index.js';

const NOW = new Date('2026-12-31T00:00:00.000Z');
const STEPS = [
  'course_detail_view', 'pricing_visible', 'cta_click', 'form_view', 'form_start',
  'form_submit', 'lead', 'initiate_checkout', 'redirect_to_payment', 'purchase',
];

let stopDb: () => Promise<void>;

before(async () => {
  stopDb = await startTestDb();
  await Promise.all([AcquisitionVisit.init(), AcquisitionEvent.init()]);
});
after(async () => stopDb());
beforeEach(async () => {
  await Promise.all([AcquisitionVisit.deleteMany({}), AcquisitionEvent.deleteMany({})]);
});

const query = (overrides: Record<string, unknown> = {}) =>
  funnelQuerySchema.parse({ from: '2026-11-10', to: '2026-11-16', timezone: 'America/Argentina/Tucuman', ...overrides });

const at = (day: string, time: string) => `2026-11-${day}T${time}.000Z`;
const plusDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();

/** Furthest step reached: A purchase, B form_submit (10 days later), C none, D form_view, E purchase with no earlier steps. */
const seedFunnel = async () => {
  const log = async (visitId: string, visitorId: string, name: string, when: string, courseId?: string) =>
    acquisitionEvent({ visitId, visitorId, name, at: when, courseId, source: ['lead', 'initiate_checkout', 'purchase'].includes(name) ? 'server' : 'browser' });

  const [a, b, c, d, e] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const startA = at('10', '12:00:00');
  const va = await visit({ visitorId: a, at: startA, channel: 'meta_paid', platform: 'instagram' });
  for (const [i, name] of STEPS.filter((step) => step !== 'redirect_to_payment').entries()) {
    await log(va, a, name, plusDays(startA, 0).replace('12:00:00', `12:${String(i + 1).padStart(2, '0')}:00`), 'c1');
  }

  const startB = at('11', '12:00:00');
  const vb = await visit({ visitorId: b, at: startB, channel: 'meta_paid', platform: 'instagram' });
  await log(vb, b, 'course_detail_view', at('11', '12:01:00'), 'c1');
  await log(vb, b, 'cta_click', at('11', '12:02:00'), 'c1');
  await log(vb, b, 'form_submit', plusDays(startB, 10), 'c1');

  const vc = await visit({ visitorId: c, at: at('12', '12:00:00'), channel: 'direct' });
  await log(vc, c, 'page_view', at('12', '12:01:00'));

  const startD = at('13', '12:00:00');
  const vd = await visit({ visitorId: d, at: startD, channel: 'instagram_organic', platform: 'instagram' });
  await log(vd, d, 'form_view', at('13', '12:05:00'));
  await log(vd, d, 'purchase', plusDays(startD, 31));

  const ve = await visit({ visitorId: e, at: at('14', '12:00:00'), channel: 'google_paid', platform: 'google' });
  await log(ve, e, 'purchase', at('14', '12:05:00'), 'c2');
};

const counts = (report: Awaited<ReturnType<typeof getFunnelReport>>) => report.data.steps.map((step) => step.visits);

test('cohort: every visit is counted at the furthest step it reached and at all steps before it', async () => {
  await seedFunnel();
  const report = await getFunnelReport(query(), NOW);
  assert.deepEqual(report.data.steps.map((step) => step.step), ['visit', ...STEPS]);
  assert.deepEqual(counts(report), [5, 4, 4, 4, 4, 3, 3, 2, 2, 2, 2]);
  assert.equal(report.data.independentCounts, false);
  assert.equal(report.reportingMode, 'acquisition_cohort');
});

test('cohort: conversion from the previous step and from the top never exceed 100%', async () => {
  await seedFunnel();
  const { steps } = (await getFunnelReport(query(), NOW)).data;
  assert.equal(steps[0].conversionFromPrevious, null);
  assert.equal(steps[0].conversionFromTop, 1);
  assert.equal(steps[1].conversionFromPrevious, 4 / 5);
  assert.equal(steps[5].conversionFromPrevious, 3 / 4);
  assert.equal(steps[7].conversionFromPrevious, 2 / 3);
  assert.equal(steps[10].conversionFromTop, 2 / 5);
  for (const step of steps) assert.ok((step.conversionFromPrevious ?? 0) <= 1 && (step.conversionFromTop ?? 0) <= 1, step.step);
});

test('cohort: events after the outcome window do not count', async () => {
  await seedFunnel();
  assert.deepEqual(counts(await getFunnelReport(query({ outcomeWindowDays: 7 }), NOW)), [5, 4, 4, 4, 3, 2, 2, 2, 2, 2, 2]);
});

test('cohort: filters narrow the visits of the funnel', async () => {
  await seedFunnel();
  assert.deepEqual(counts(await getFunnelReport(query({ channel: 'meta_paid' }), NOW)), [2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1]);
  assert.deepEqual(counts(await getFunnelReport(query({ course: 'c1' }), NOW)), [2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1]);
  assert.deepEqual(counts(await getFunnelReport(query({ course: 'c2' }), NOW)), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(counts(await getFunnelReport(query({ perspective: 'first_touch', channel: 'google_paid' }), NOW)), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
});

test('event_period: independent counts of visits with each event in the range, without rates', async () => {
  await seedFunnel();
  const report = await getFunnelReport(query({ reportingMode: 'event_period' }), NOW);
  assert.deepEqual(counts(report), [5, 2, 1, 2, 2, 1, 1, 1, 1, 0, 2]);
  assert.equal(report.data.independentCounts, true);
  assert.equal(report.outcomeWindowDays, null);
  for (const step of report.data.steps) assert.deepEqual([step.conversionFromPrevious, step.conversionFromTop], [null, null], step.step);
});

test('event_period: filters apply through the visit of each event', async () => {
  await seedFunnel();
  const report = await getFunnelReport(query({ reportingMode: 'event_period', channel: 'google_paid' }), NOW);
  assert.deepEqual(counts(report), [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
});

test('empty funnels are zeros with null rates', async () => {
  const { data } = await getFunnelReport(query(), NOW);
  assert.deepEqual(data.steps.map((step) => step.visits), Array(11).fill(0));
  assert.equal(data.steps[1].conversionFromPrevious, null);
});

test('funnel responses carry no personal identifiers', async () => {
  await seedFunnel();
  const serialized = JSON.stringify(await getFunnelReport(query(), NOW));
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(serialized));
});
