import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';
import AcquisitionEvent from '../../models/AcquisitionEvent/index.js';
import AcquisitionVisit from '../../models/AcquisitionVisit/index.js';
import Inscription from '../../models/Inscription.js';
import { acquisitionEvent, inscription, lead, visit } from '../../utils/testing/acquisitionFixtures.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { journeysQuerySchema } from './filters.js';
import { getJourneyDetail, getJourneys } from './index.js';

const NOW = new Date('2026-12-31T00:00:00.000Z');

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
  journeysQuerySchema.parse({ from: '2026-11-10', to: '2026-11-16', timezone: 'America/Argentina/Tucuman', ...overrides });

const ids: Record<string, string> = {};

const seedJourneys = async () => {
  const [v1, v2, v3, v4] = Array.from({ length: 4 }, () => randomUUID());
  ids.buyer = await visit({ visitorId: v1, at: '2026-11-10T12:00:00.000Z', channel: 'meta_paid', platform: 'instagram', landing: 'curso-a', device: 'mobile', campaign: 'black', source: 'instagram', medium: 'cpc' });
  const inscriptionId = await inscription({
    createdAt: '2026-11-10T12:10:00.000Z', price: 100000, status: 'paid', paymentDate: '2026-11-10T13:00:00.000Z', payments: [[100000, '2026-11-10T13:00:00.000Z']],
  });
  const log = (visitId: string, visitorId: string, name: string, when: string, extra: Record<string, unknown> = {}) =>
    acquisitionEvent({ visitId, visitorId, name, at: when, source: ['lead', 'purchase'].includes(name) ? 'server' : 'browser', ...extra });
  await log(ids.buyer, v1, 'course_detail_view', '2026-11-10T12:01:00.000Z', { courseId: 'c1', path: '/lp/curso' });
  await log(ids.buyer, v1, 'cta_click', '2026-11-10T12:05:00.000Z');
  await lead(ids.buyer, v1, inscriptionId, '2026-11-10T12:10:00.000Z');
  await log(ids.buyer, v1, 'purchase', '2026-11-10T13:00:00.000Z', { inscriptionId, eventId: `purchase_${inscriptionId}` });
  ids.inscription = inscriptionId;

  ids.bounce = await visit({ visitorId: v2, at: '2026-11-11T12:00:00.000Z', channel: 'direct' });
  await log(ids.bounce, v2, 'page_view', '2026-11-11T12:00:10.000Z');

  ids.browser = await visit({ visitorId: v3, at: '2026-11-12T12:00:00.000Z', channel: 'instagram_organic', platform: 'instagram' });
  await log(ids.browser, v3, 'form_view', '2026-11-12T12:03:00.000Z');

  await visit({ visitorId: v4, at: '2026-11-17T03:00:00.000Z', channel: 'direct' }); // exactly `to`: excluded
};

test('lists the visits of the range newest first with their furthest step and outcome', async () => {
  await seedJourneys();
  const { data, pagination } = await getJourneys(query(), NOW);
  assert.deepEqual(data.journeys.map((journey) => journey.visitId), [ids.browser, ids.bounce, ids.buyer]);
  assert.deepEqual(pagination, { page: 1, limit: 20, total: 3, totalPages: 1 });

  const buyer = data.journeys[2];
  assert.deepEqual(
    [buyer.channelGroup, buyer.sourcePlatform, buyer.landingSlug, buyer.device, buyer.maxStep, buyer.hasLead, buyer.hasPurchase, buyer.revenue, buyer.eventCount],
    ['meta_paid', 'instagram', 'curso-a', 'mobile', 'purchase', true, true, 100000, 4],
  );
  const bounce = data.journeys[1];
  assert.deepEqual([bounce.maxStep, bounce.hasLead, bounce.hasPurchase, bounce.revenue, bounce.eventCount], ['visit', false, false, 0, 1]);
  assert.equal(data.journeys[0].maxStep, 'form_view');
});

test('paginates on the server and reports totals', async () => {
  await seedJourneys();
  const first = await getJourneys(query({ limit: '2' }), NOW);
  const second = await getJourneys(query({ limit: '2', page: '2' }), NOW);
  assert.deepEqual(first.data.journeys.map((journey) => journey.visitId), [ids.browser, ids.bounce]);
  assert.deepEqual(second.data.journeys.map((journey) => journey.visitId), [ids.buyer]);
  assert.deepEqual(first.pagination, { page: 1, limit: 2, total: 3, totalPages: 2 });
  assert.deepEqual((await getJourneys(query({ limit: '2', page: '9' }), NOW)).data.journeys, []);
});

test('bounds page and limit', () => {
  for (const params of [{ page: '0' }, { limit: '0' }, { limit: '101' }, { page: 'x' }, { limit: '1.5' }]) {
    assert.equal(journeysQuerySchema.safeParse({ from: '2026-11-10', to: '2026-11-16', ...params }).success, false, JSON.stringify(params));
  }
});

test('filters apply to the visit', async () => {
  await seedJourneys();
  assert.deepEqual((await getJourneys(query({ channel: 'direct' }), NOW)).data.journeys.map((j) => j.visitId), [ids.bounce]);
  assert.deepEqual((await getJourneys(query({ campaign: 'black' }), NOW)).data.journeys.map((j) => j.visitId), [ids.buyer]);
  assert.deepEqual((await getJourneys(query({ device: 'mobile' }), NOW)).data.journeys.map((j) => j.visitId), [ids.buyer]);
  assert.equal((await getJourneys(query({ channel: 'direct' }), NOW)).pagination.total, 1);
});

test('the list never exposes visitor ids or personal data', async () => {
  await seedJourneys();
  const serialized = JSON.stringify(await getJourneys(query(), NOW));
  for (const secret of ['example.com', 'Nombre', 'Apellido', '3815550000', 'visitorId']) assert.ok(!serialized.includes(secret), secret);
});

test('detail: ordered timeline, attribution and linked conversions without personal data', async () => {
  await seedJourneys();
  const detail = await getJourneyDetail(ids.buyer, NOW);
  assert.ok(detail);
  assert.deepEqual(detail.data.events.map((event) => event.name), ['course_detail_view', 'cta_click', 'lead', 'purchase']);
  assert.deepEqual(detail.data.events[0], { name: 'course_detail_view', occurredAt: '2026-11-10T12:01:00.000Z', source: 'browser', path: '/lp/curso', courseId: 'c1' });
  assert.deepEqual(
    [detail.data.visit.channelGroup, detail.data.visit.acquisitionType, detail.data.visit.rawAttribution.campaign, detail.data.visit.rawAttribution.medium],
    ['meta_paid', 'x', 'black', 'cpc'],
  );
  assert.deepEqual(detail.data.conversions, [{ inscriptionId: ids.inscription, paymentStatus: 'paid', collected: 100000 }]);

  const serialized = JSON.stringify(detail);
  for (const secret of ['example.com', 'Nombre', 'Apellido', '3815550000', 'visitorId']) assert.ok(!serialized.includes(secret), secret);
});

test('detail: unknown visit is null', async () => {
  assert.equal(await getJourneyDetail(randomUUID(), NOW), null);
});
