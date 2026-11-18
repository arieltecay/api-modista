import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';
import { Types } from 'mongoose';
import AcquisitionEvent from '../../models/AcquisitionEvent/index.js';
import AcquisitionVisit from '../../models/AcquisitionVisit/index.js';
import Inscription from '../../models/Inscription.js';
import { inscription, lead, visit } from '../../utils/testing/acquisitionFixtures.js';
import type { InscriptionFixture } from '../../utils/testing/acquisitionFixtures.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { reportQuerySchema } from './filters.js';
import { getChannelsReport, getOverviewReport } from './index.js';

const NOW = new Date('2026-12-31T00:00:00.000Z');
const TIMEZONE = 'America/Argentina/Tucuman';

let stopDb: () => Promise<void>;

before(async () => {
  stopDb = await startTestDb();
  await Promise.all([AcquisitionVisit.init(), AcquisitionEvent.init(), Inscription.init()]);
});
after(async () => stopDb());
beforeEach(async () => {
  await Promise.all([AcquisitionVisit.deleteMany({}), AcquisitionEvent.deleteMany({}), Inscription.deleteMany({})]);
});

const query = (overrides: Record<string, unknown> = {}) =>
  reportQuerySchema.parse({ from: '2026-11-10', to: '2026-11-16', timezone: TIMEZONE, ...overrides });

/** Range: [2026-11-10T03:00Z, 2026-11-17T03:00Z). See the expectations below for what each visitor is. */
const seedScenario = async () => {
  const [v1, v2, v3, v4, v5, v6, v7, v8, v9] = Array.from({ length: 9 }, () => randomUUID());

  const a1 = await visit({ visitorId: v1, at: '2026-11-10T12:00:00.000Z', channel: 'meta_paid', platform: 'instagram', campaign: 'black', landing: 'curso-a', device: 'mobile' });
  const i1 = await inscription({ createdAt: '2026-11-10T12:10:00.000Z', price: 100000, status: 'paid', paymentDate: '2026-11-20T12:00:00.000Z', payments: [[50000, '2026-11-10T12:30:00.000Z'], [50000, '2026-11-20T12:00:00.000Z']] });
  await lead(a1, v1, i1, '2026-11-10T12:10:00.000Z');
  await visit({ visitorId: v1, at: '2026-11-13T12:00:00.000Z', channel: 'direct', landing: 'curso-b' });

  const a2 = await visit({ visitorId: v2, at: '2026-11-11T12:00:00.000Z', channel: 'instagram_organic', platform: 'instagram', landing: 'curso-b' });
  const i2 = await inscription({ createdAt: '2026-11-11T12:20:00.000Z', price: 80000, status: 'partial', payments: [[30000, '2026-11-11T13:00:00.000Z']] });
  await lead(a2, v2, i2, '2026-11-11T12:20:00.000Z');

  await visit({ visitorId: v3, at: '2026-11-12T12:00:00.000Z', channel: 'meta_paid', platform: 'instagram', campaign: 'black', landing: 'curso-b' });

  await visit({ visitorId: v4, at: '2026-11-10T03:00:00.000Z', channel: 'direct' }); // exactly `from`: included
  await visit({ visitorId: v4, at: '2026-11-17T03:00:00.000Z', channel: 'direct' }); // exactly `to`: excluded
  await visit({ visitorId: v4, at: '2026-11-10T02:59:59.999Z', channel: 'direct' }); // just before: excluded

  const a5 = await visit({ visitorId: v5, at: '2026-11-10T12:00:00.000Z', channel: 'meta_paid', platform: 'instagram', campaign: 'cyber', landing: 'curso-b' });
  const i5 = await inscription({ createdAt: '2026-11-10T12:05:00.000Z', price: 50000, status: 'paid', paymentDate: '2026-12-20T12:00:00.000Z', payments: [[50000, '2026-12-20T12:00:00.000Z']] });
  await lead(a5, v5, i5, '2026-11-10T12:05:00.000Z');

  const a6 = await visit({ visitorId: v6, at: '2026-11-14T12:00:00.000Z', channel: 'google_organic', platform: 'google' });
  await lead(a6, v6, new Types.ObjectId().toHexString(), '2026-11-14T12:05:00.000Z'); // inscription no longer exists

  const a7 = await visit({ visitorId: v7, at: '2026-11-12T12:00:00.000Z', channel: 'google_paid', platform: 'google' });
  const i7 = await inscription({ createdAt: '2026-11-12T12:30:00.000Z', price: 60000, status: 'paid', paymentDate: '2026-11-12T15:00:00.000Z' }); // legacy: no history
  await lead(a7, v7, i7, '2026-11-12T12:30:00.000Z');

  await visit({ visitorId: v8, at: '2026-11-14T12:00:00.000Z', channel: 'unknown' });

  // Out of range visit whose inscription collects money inside the range, and an unlinked inscription.
  const a9 = await visit({ visitorId: v9, at: '2026-10-01T12:00:00.000Z', channel: 'meta_paid', platform: 'instagram', campaign: 'black' });
  const i9 = await inscription({ createdAt: '2026-10-01T12:10:00.000Z', price: 70000, status: 'partial', payments: [[20000, '2026-11-12T12:00:00.000Z']] });
  await lead(a9, v9, i9, '2026-10-01T12:10:00.000Z');
  await inscription({ createdAt: '2026-11-13T10:00:00.000Z', price: 40000, status: 'paid', paymentDate: '2026-11-13T11:00:00.000Z', payments: [[40000, '2026-11-13T11:00:00.000Z']] });
};

const channelOf = (report: Awaited<ReturnType<typeof getChannelsReport>>, channel: string, platform: string) =>
  report.data.channels.find((row) => row.channelGroup === channel && row.sourcePlatform === platform);

// ---------- acquisition_cohort ----------

test('cohort: visits, visitors, leads, purchases, partial payments and revenue per channel', async () => {
  await seedScenario();
  const report = await getChannelsReport(query(), NOW);

  assert.equal(report.reportingMode, 'acquisition_cohort');
  assert.equal(report.outcomeWindowDays, 30);
  assert.equal(report.data.channels.length, 6);

  assert.deepEqual(channelOf(report, 'meta_paid', 'instagram'), {
    channelGroup: 'meta_paid', sourcePlatform: 'instagram', visits: 3, visitors: 3, leads: 2, purchases: 1,
    partialPayments: 0, revenue: 100000, leadRate: 2 / 3, purchaseRate: 1 / 3, averageTicket: 100000, revenueShare: 100000 / 190000,
  });
  assert.deepEqual(channelOf(report, 'instagram_organic', 'instagram'), {
    channelGroup: 'instagram_organic', sourcePlatform: 'instagram', visits: 1, visitors: 1, leads: 1, purchases: 0,
    partialPayments: 1, revenue: 30000, leadRate: 1, purchaseRate: 0, averageTicket: null, revenueShare: 30000 / 190000,
  });
  assert.deepEqual(channelOf(report, 'google_paid', 'google'), {
    channelGroup: 'google_paid', sourcePlatform: 'google', visits: 1, visitors: 1, leads: 1, purchases: 1,
    partialPayments: 0, revenue: 60000, leadRate: 1, purchaseRate: 1, averageTicket: 60000, revenueShare: 60000 / 190000,
  });
  const direct = channelOf(report, 'direct', 'unknown');
  assert.deepEqual([direct?.visits, direct?.visitors, direct?.leads, direct?.revenue], [2, 2, 0, 0]);
  assert.equal(channelOf(report, 'google_organic', 'google')?.leads, 0, 'a lead whose inscription was deleted is not a lead');
  assert.equal(channelOf(report, 'unknown', 'unknown')?.visits, 1);
});

test('cohort: rows are ordered by revenue, then visits, then channel name', async () => {
  await seedScenario();
  const report = await getChannelsReport(query(), NOW);
  assert.deepEqual(report.data.channels.map((row) => row.channelGroup), [
    'meta_paid', 'google_paid', 'instagram_organic', 'direct', 'google_organic', 'unknown',
  ]);
});

test('cohort: totals count a visitor who appears in two channels once, and unlinked is not computable', async () => {
  await seedScenario();
  const { data } = await getChannelsReport(query(), NOW);
  assert.deepEqual(data.totals, {
    visits: 9, visitors: 8, leads: 4, purchases: 2, partialPayments: 1, revenue: 190000,
    leadRate: 4 / 9, purchaseRate: 2 / 9, averageTicket: 95000,
  });
  assert.equal(data.unlinked, null);
});

test('cohort: the 7-day window drops outcomes that happen later', async () => {
  await seedScenario();
  const report = await getChannelsReport(query({ outcomeWindowDays: 7 }), NOW);
  const metaPaid = channelOf(report, 'meta_paid', 'instagram');
  assert.deepEqual([metaPaid?.leads, metaPaid?.purchases, metaPaid?.partialPayments, metaPaid?.revenue], [2, 0, 1, 50000]);
  assert.equal(channelOf(report, 'google_paid', 'google')?.purchases, 1);
  assert.equal(report.outcomeWindowDays, 7);
});

test('cohort: reports whether the outcome window has fully elapsed', async () => {
  await seedScenario();
  assert.equal((await getChannelsReport(query(), NOW)).outcomesComplete, true);
  assert.equal((await getChannelsReport(query(), new Date('2026-11-20T00:00:00.000Z'))).outcomesComplete, false);
});

test('cohort: revenue is what was collected, never the list price', async () => {
  const visitorId = randomUUID();
  const visitId = await visit({ visitorId, at: '2026-11-11T12:00:00.000Z', channel: 'meta_paid', platform: 'instagram' });
  const id = await inscription({ createdAt: '2026-11-11T12:10:00.000Z', price: 50000, status: 'paid', paymentDate: '2026-11-11T13:00:00.000Z', payments: [[30000, '2026-11-11T13:00:00.000Z']] });
  await lead(visitId, visitorId, id, '2026-11-11T12:10:00.000Z');
  const row = channelOf(await getChannelsReport(query(), NOW), 'meta_paid', 'instagram');
  assert.equal(row?.revenue, 30000);
});

// ---------- event_period ----------

test('event_period: counts events inside the range, attributes them to the linked visit and never computes rates', async () => {
  await seedScenario();
  const report = await getChannelsReport(query({ reportingMode: 'event_period' }), NOW);

  assert.equal(report.reportingMode, 'event_period');
  assert.equal(report.outcomeWindowDays, null);
  assert.equal(report.outcomesComplete, null);

  assert.deepEqual(channelOf(report, 'meta_paid', 'instagram'), {
    channelGroup: 'meta_paid', sourcePlatform: 'instagram', visits: 3, visitors: 3, leads: 2, purchases: 0,
    partialPayments: 2, revenue: 70000, leadRate: null, purchaseRate: null, averageTicket: null, revenueShare: 70000 / 200000,
  });
  const organic = channelOf(report, 'instagram_organic', 'instagram');
  assert.deepEqual([organic?.leads, organic?.partialPayments, organic?.revenue], [1, 1, 30000]);
  const googlePaid = channelOf(report, 'google_paid', 'google');
  assert.deepEqual([googlePaid?.leads, googlePaid?.purchases, googlePaid?.revenue], [1, 1, 60000]);
});

test('event_period: conversions without a linkable visit are reported apart, not hidden', async () => {
  await seedScenario();
  const { data } = await getChannelsReport(query({ reportingMode: 'event_period' }), NOW);
  assert.deepEqual(data.unlinked, { leads: 1, purchases: 1, partialPayments: 0, revenue: 40000 });
  assert.deepEqual(
    [data.totals.leads, data.totals.purchases, data.totals.partialPayments, data.totals.revenue],
    [5, 2, 3, 200000],
  );
  assert.equal(data.totals.leadRate, null);
});

// ---------- attribution perspectives ----------

const seedFirstTouch = async () => {
  const [f, u] = [randomUUID(), randomUUID()];
  await visit({ visitorId: f, at: '2026-11-01T12:00:00.000Z', channel: 'meta_paid', platform: 'instagram' });
  await visit({ visitorId: f, at: '2026-11-12T12:00:00.000Z', channel: 'direct' });
  const f3 = await visit({ visitorId: f, at: '2026-11-13T12:00:00.000Z', channel: 'google_organic', platform: 'google' });
  const id = await inscription({ createdAt: '2026-11-13T12:10:00.000Z', price: 10000, status: 'paid', paymentDate: '2026-11-13T13:00:00.000Z', payments: [[10000, '2026-11-13T13:00:00.000Z']] });
  await lead(f3, f, id, '2026-11-13T12:10:00.000Z');

  await visit({ visitorId: u, at: '2026-11-01T12:00:00.000Z', channel: 'unknown' });
  await visit({ visitorId: u, at: '2026-11-02T12:00:00.000Z', channel: 'google_paid', platform: 'google' });
  await visit({ visitorId: u, at: '2026-11-12T12:00:00.000Z', channel: 'direct' });
};

test('first_touch: every visit and conversion belongs to the visitor’s first known origin', async () => {
  await seedFirstTouch();
  const report = await getChannelsReport(query({ perspective: 'first_touch' }), NOW);
  assert.deepEqual(report.data.channels.map((row) => [row.channelGroup, row.visits, row.visitors, row.leads, row.purchases, row.revenue]), [
    ['meta_paid', 2, 1, 1, 1, 10000],
    ['google_paid', 1, 1, 0, 0, 0],
  ]);
  assert.equal(report.perspective, 'first_touch');
});

test('visit_touch (default) keeps each visit in its own channel for the same data', async () => {
  await seedFirstTouch();
  const report = await getChannelsReport(query(), NOW);
  assert.deepEqual(report.data.channels.map((row) => row.channelGroup).sort(), ['direct', 'google_organic']);
});

test('last_non_direct: direct and unknown visits inherit the latest earlier non-direct origin', async () => {
  const [g, h, k] = [randomUUID(), randomUUID(), randomUUID()];
  await visit({ visitorId: g, at: '2026-11-01T12:00:00.000Z', channel: 'instagram_organic', platform: 'instagram' });
  const g2 = await visit({ visitorId: g, at: '2026-11-12T12:00:00.000Z', channel: 'direct' });
  const id = await inscription({ createdAt: '2026-11-12T12:10:00.000Z', price: 10000, status: 'pending' });
  await lead(g2, g, id, '2026-11-12T12:10:00.000Z');

  await visit({ visitorId: h, at: '2026-11-12T12:00:00.000Z', channel: 'direct' });
  await visit({ visitorId: h, at: '2026-11-13T12:00:00.000Z', channel: 'google_paid', platform: 'google' });
  await visit({ visitorId: h, at: '2026-11-14T12:00:00.000Z', channel: 'unknown' });
  await visit({ visitorId: k, at: '2026-11-12T12:00:00.000Z', channel: 'unknown' });

  const report = await getChannelsReport(query({ perspective: 'last_non_direct' }), NOW);
  assert.deepEqual(
    report.data.channels.map((row) => [row.channelGroup, row.visits, row.leads]).sort(),
    [['direct', 1, 0], ['google_paid', 2, 0], ['instagram_organic', 1, 1], ['unknown', 1, 0]],
  );
});

// ---------- filters ----------

test('filters narrow visits and the conversions linked to them', async () => {
  await seedScenario();
  const byCampaign = await getChannelsReport(query({ campaign: 'black' }), NOW);
  const row = channelOf(byCampaign, 'meta_paid', 'instagram');
  assert.deepEqual([byCampaign.data.channels.length, row?.visits, row?.leads, row?.revenue], [1, 2, 1, 100000]);

  assert.equal((await getChannelsReport(query({ landing: 'curso-a' }), NOW)).data.totals.visits, 1);
  assert.equal((await getChannelsReport(query({ device: 'mobile' }), NOW)).data.totals.visits, 1);
  assert.deepEqual((await getChannelsReport(query({ channel: 'instagram_organic' }), NOW)).data.channels.map((r) => r.channelGroup), ['instagram_organic']);
  assert.deepEqual((await getChannelsReport(query({ platform: 'google' }), NOW)).data.channels.map((r) => r.channelGroup).sort(), ['google_organic', 'google_paid']);
});

test('the channel filter applies to the attributed channel of the chosen perspective', async () => {
  await seedFirstTouch();
  const report = await getChannelsReport(query({ perspective: 'first_touch', channel: 'meta_paid' }), NOW);
  assert.deepEqual(report.data.channels.map((row) => [row.channelGroup, row.visits]), [['meta_paid', 2]]);
});

test('event_period filters also exclude unlinked conversions, which cannot match a visit filter', async () => {
  await seedScenario();
  const { data } = await getChannelsReport(query({ reportingMode: 'event_period', campaign: 'black' }), NOW);
  assert.equal(data.unlinked, null);
});

// ---------- overview ----------

test('overview: headline numbers, rates and coverage', async () => {
  await seedScenario();
  const overview = await getOverviewReport(query(), NOW);
  assert.deepEqual(overview.data, {
    visits: 9, visitors: 8, attributableVisits: 8, leads: 4, purchases: 2, partialPayments: 1, revenue: 190000,
    leadRate: 4 / 9, purchaseRate: 2 / 9, averageTicket: 95000, unlinked: null,
  });
  assert.deepEqual(overview.coverage, {
    observedConsentedVisits: 9, knownChannelVisits: 8, attributionCoverage: 8 / 9, totalSiteVisits: null, measurementCoverage: null,
  });
  assert.equal(overview.generatedAt, NOW.toISOString());
  assert.equal(overview.timezone, TIMEZONE);
  assert.equal(overview.range.fromUtc, '2026-11-10T03:00:00.000Z');
  assert.equal(overview.range.toExclusiveUtc, '2026-11-17T03:00:00.000Z');
});

test('empty ranges give zeros and null rates, never NaN', async () => {
  const overview = await getOverviewReport(query(), NOW);
  assert.deepEqual(overview.data, {
    visits: 0, visitors: 0, attributableVisits: 0, leads: 0, purchases: 0, partialPayments: 0, revenue: 0,
    leadRate: null, purchaseRate: null, averageTicket: null, unlinked: null,
  });
  assert.equal(overview.coverage.attributionCoverage, null);
});

test('reports never contain personal data', async () => {
  await seedScenario();
  const serialized = JSON.stringify([await getChannelsReport(query(), NOW), await getChannelsReport(query({ reportingMode: 'event_period' }), NOW)]);
  assert.ok(!serialized.includes('example.com') && !serialized.includes('Nombre') && !serialized.includes('3815550000'));
});

// ---------- review fixes ----------

const convertedVisit = async (
  options: { at: string; channel?: string; leadAt?: string },
  fixture: InscriptionFixture,
) => {
  const visitorId = randomUUID();
  const visitId = await visit({ visitorId, at: options.at, channel: options.channel ?? 'meta_paid', platform: 'instagram' });
  const id = await inscription(fixture);
  await lead(visitId, visitorId, id, options.leadAt ?? options.at);
  return id;
};

const metaPaid = async (overrides: Record<string, unknown> = {}) =>
  channelOf(await getChannelsReport(query(overrides), NOW), 'meta_paid', 'instagram');

test('a partial payer stays partial even when the inscription is fully paid after the window', async () => {
  await convertedVisit({ at: '2026-11-10T12:00:00.000Z' }, {
    createdAt: '2026-11-10T12:05:00.000Z', price: 100000, status: 'paid', paymentDate: '2026-12-20T12:00:00.000Z',
    payments: [[30000, '2026-11-10T13:00:00.000Z'], [70000, '2026-12-20T12:00:00.000Z']],
  });
  const row = await metaPaid();
  assert.deepEqual([row?.purchases, row?.partialPayments, row?.revenue], [0, 1, 30000]);
});

test('a purchase completed inside the window is a purchase, not also a partial', async () => {
  await convertedVisit({ at: '2026-11-10T12:00:00.000Z' }, {
    createdAt: '2026-11-10T12:05:00.000Z', price: 100000, status: 'paid', paymentDate: '2026-11-15T12:00:00.000Z',
    payments: [[30000, '2026-11-10T13:00:00.000Z'], [70000, '2026-11-15T12:00:00.000Z']],
  });
  const row = await metaPaid();
  assert.deepEqual([row?.purchases, row?.partialPayments, row?.revenue], [1, 0, 100000]);
});

test('legacy inscriptions without history: a paid deposit is what was collected, like the existing dashboard', async () => {
  await convertedVisit({ at: '2026-11-10T12:00:00.000Z' }, {
    createdAt: '2026-11-10T12:05:00.000Z', price: 20000, status: 'paid', paymentDate: '2026-11-11T12:00:00.000Z',
    depositAmount: 5000, depositDate: '2026-11-11T12:00:00.000Z',
  });
  const row = await metaPaid();
  assert.deepEqual([row?.purchases, row?.revenue], [1, 5000]);
});

test('legacy inscriptions without history: a pending deposit is collected money but not a purchase', async () => {
  await convertedVisit({ at: '2026-11-10T12:00:00.000Z' }, {
    createdAt: '2026-11-10T12:05:00.000Z', price: 20000, status: 'pending', depositAmount: 3000, depositDate: '2026-11-11T12:00:00.000Z',
  });
  const row = await metaPaid();
  assert.deepEqual([row?.purchases, row?.partialPayments, row?.revenue], [0, 1, 3000]);
});

test('legacy paid inscription with no dates at all falls back to its creation date and list price', async () => {
  await convertedVisit({ at: '2026-11-10T12:00:00.000Z' }, { createdAt: '2026-11-10T12:05:00.000Z', price: 20000, status: 'paid' });
  const row = await metaPaid();
  assert.deepEqual([row?.purchases, row?.revenue], [1, 20000]);
});

test('outcome window edges: a payment exactly at start + window is out, one millisecond earlier is in', async () => {
  const at = '2026-11-10T12:00:00.000Z';
  const edge = (iso: string) => ({
    createdAt: '2026-11-10T12:05:00.000Z', price: 10000, status: 'paid' as const, paymentDate: iso, payments: [[10000, iso] as [number, string]],
  });
  await convertedVisit({ at }, edge('2026-12-10T12:00:00.000Z'));
  await convertedVisit({ at }, edge('2026-12-10T11:59:59.999Z'));
  const row = await metaPaid();
  assert.deepEqual([row?.leads, row?.purchases, row?.revenue], [2, 1, 10000]);
});

test('ties on startedAt are resolved by visitId, so attribution is deterministic', async () => {
  const [first, last] = [randomUUID(), randomUUID()];
  const at = '2026-11-12T12:00:00.000Z';
  const aaaa = 'aaaaaaaa-0000-4000-8000-000000000000';
  const bbbb = 'bbbbbbbb-0000-4000-8000-000000000000';
  await visit({ visitorId: first, visitId: bbbb, at, channel: 'meta_paid', platform: 'instagram' });
  await visit({ visitorId: first, visitId: aaaa, at, channel: 'google_paid', platform: 'google' });
  assert.deepEqual((await getChannelsReport(query({ perspective: 'first_touch' }), NOW)).data.channels.map((r) => [r.channelGroup, r.visits]), [['google_paid', 2]]);

  await Promise.all([AcquisitionVisit.deleteMany({})]);
  await visit({ visitorId: last, visitId: aaaa, at, channel: 'direct' });
  await visit({ visitorId: last, visitId: bbbb, at, channel: 'google_paid', platform: 'google' });
  assert.deepEqual((await getChannelsReport(query({ perspective: 'last_non_direct' }), NOW)).data.channels.map((r) => [r.channelGroup, r.visits]), [['google_paid', 2]]);
});
