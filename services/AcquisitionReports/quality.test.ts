import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';
import AcquisitionEvent from '../../models/AcquisitionEvent/index.js';
import AcquisitionSignalAttempt from '../../models/AcquisitionSignalAttempt/index.js';
import AcquisitionVisit from '../../models/AcquisitionVisit/index.js';
import Inscription from '../../models/Inscription.js';
import { acquisitionEvent, capiAttempt, inscription, lead, visit } from '../../utils/testing/acquisitionFixtures.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { qualityQuerySchema } from './filters.js';
import { getQualityReport } from './index.js';

const NOW = new Date('2026-11-18T12:00:00.000Z');
const FRESH = new Date('2026-11-11T14:00:00.000Z'); // 1.5 hours after the data below, inside the stale limit

let stopDb: () => Promise<void>;

before(async () => {
  stopDb = await startTestDb();
  await Promise.all([AcquisitionVisit.init(), AcquisitionEvent.init(), AcquisitionSignalAttempt.init(), Inscription.init()]);
});
after(async () => stopDb());
beforeEach(async () => {
  await Promise.all([
    AcquisitionVisit.deleteMany({}), AcquisitionEvent.deleteMany({}), AcquisitionSignalAttempt.deleteMany({}), Inscription.deleteMany({}),
  ]);
});

const query = () => qualityQuerySchema.parse({ from: '2026-11-10', to: '2026-11-16', timezone: 'America/Argentina/Tucuman' });
const report = (now = NOW) => getQualityReport(query(), now);
const ruleOf = async (code: string, now = NOW) => (await report(now)).data.rules.find((rule) => rule.code === code);

const visits = async (count: number, overrides: Partial<Parameters<typeof visit>[0]> = {}) => {
  const created: Array<{ visitId: string; visitorId: string }> = [];
  for (let i = 0; i < count; i += 1) {
    const visitorId = randomUUID();
    created.push({ visitorId, visitId: await visit({ visitorId, at: '2026-11-11T12:00:00.000Z', channel: 'direct', ...overrides }) });
  }
  return created;
};

test('a healthy dataset triggers no rule', async () => {
  const [v] = await visits(10);
  await acquisitionEvent({ visitId: v.visitId, visitorId: v.visitorId, name: 'page_view', at: '2026-11-11T12:00:30.000Z' });
  const result = await report(FRESH);
  assert.deepEqual(result.data.rules, []);
  assert.ok(result.data.evaluated.includes('UNKNOWN_CHANNEL_RATE_HIGH'));
  assert.equal(result.data.tracking.stale, false);
});

test('UNKNOWN_CHANNEL_RATE_HIGH: warning from 20%, critical from 50%, silent below', async () => {
  await visits(9);
  await visits(1, { channel: 'unknown' });
  assert.equal(await ruleOf('UNKNOWN_CHANNEL_RATE_HIGH', FRESH), undefined);

  await visits(2, { channel: 'unknown' });
  const warning = await ruleOf('UNKNOWN_CHANNEL_RATE_HIGH', FRESH);
  assert.deepEqual([warning?.severity, warning?.affected, warning?.universe], ['warning', 3, 12]);
  assert.equal(warning?.percentage, 3 / 12);
  assert.equal(warning?.firstOccurrence, '2026-11-11T12:00:00.000Z');

  await visits(9, { channel: 'unknown' });
  assert.equal((await ruleOf('UNKNOWN_CHANNEL_RATE_HIGH', FRESH))?.severity, 'critical');
});

test('UTM_SOURCE_WITHOUT_MEDIUM and PAID_MEDIUM_WITHOUT_CAMPAIGN count the incomplete tagging', async () => {
  await visits(18);
  await visits(1, { source: 'newsletter' });
  await visits(1, { channel: 'meta_paid', acquisitionType: 'paid', medium: 'cpc', source: 'instagram' });
  const utm = await ruleOf('UTM_SOURCE_WITHOUT_MEDIUM', FRESH);
  assert.deepEqual([utm?.severity, utm?.affected, utm?.universe], ['info', 1, 20]);
  const paid = await ruleOf('PAID_MEDIUM_WITHOUT_CAMPAIGN', FRESH);
  assert.deepEqual([paid?.severity, paid?.affected, paid?.universe], ['warning', 1, 1]);
});

test('SOCIAL_SOURCE_CLASSIFIED_AS_PAID_WITHOUT_EVIDENCE is critical when a paid visit has no paid reason', async () => {
  await visits(1, { channel: 'meta_paid', acquisitionType: 'paid', reason: 'paid_medium', campaign: 'x', medium: 'cpc' });
  assert.equal(await ruleOf('SOCIAL_SOURCE_CLASSIFIED_AS_PAID_WITHOUT_EVIDENCE', FRESH), undefined);
  await visits(1, { channel: 'meta_paid', acquisitionType: 'paid', reason: 'social_source_without_paid_medium', campaign: 'x', medium: 'cpc' });
  assert.equal((await ruleOf('SOCIAL_SOURCE_CLASSIFIED_AS_PAID_WITHOUT_EVIDENCE', FRESH))?.severity, 'critical');
});

test('ORPHAN_EVENT and EVENT_TIME_IN_FUTURE', async () => {
  const [v] = await visits(1);
  await acquisitionEvent({ visitId: v.visitId, visitorId: v.visitorId, name: 'page_view', at: '2026-11-11T12:00:30.000Z' });
  await acquisitionEvent({ visitId: randomUUID(), visitorId: randomUUID(), name: 'cta_click', at: '2026-11-11T12:01:00.000Z' });
  await acquisitionEvent({ visitId: v.visitId, visitorId: v.visitorId, name: 'form_view', at: '2026-11-11T13:00:00.000Z', receivedAt: '2026-11-11T12:30:00.000Z' });

  const orphan = await ruleOf('ORPHAN_EVENT', FRESH);
  assert.deepEqual([orphan?.affected, orphan?.universe], [1, 3]);
  const future = await ruleOf('EVENT_TIME_IN_FUTURE', FRESH);
  assert.deepEqual([future?.severity, future?.affected, future?.universe], ['warning', 1, 3]);
});

test('PURCHASE_WITHOUT_PAYMENT flags purchase signals with no money behind them', async () => {
  const [v] = await visits(1);
  const paid = await inscription({ createdAt: '2026-11-11T12:10:00.000Z', price: 1000, status: 'paid', payments: [[1000, '2026-11-11T13:00:00.000Z']], paymentDate: '2026-11-11T13:00:00.000Z' });
  const unpaid = await inscription({ createdAt: '2026-11-11T12:20:00.000Z', price: 1000, status: 'pending' });
  for (const id of [paid, unpaid]) {
    await acquisitionEvent({ visitId: v.visitId, visitorId: v.visitorId, name: 'purchase', at: '2026-11-11T14:00:00.000Z', inscriptionId: id, eventId: `purchase_${id}`, source: 'server' });
  }
  const rule = await ruleOf('PURCHASE_WITHOUT_PAYMENT', FRESH);
  assert.deepEqual([rule?.severity, rule?.affected, rule?.universe], ['critical', 1, 2]);
});

test('PAYMENT_WITHOUT_PURCHASE_SIGNAL only flags paid, consenting inscriptions that have a lead but no purchase signal', async () => {
  const [v] = await visits(1);
  const paid = (consent = true) => inscription({
    createdAt: '2026-11-11T12:10:00.000Z', price: 1000, status: 'paid', consent,
    payments: [[1000, '2026-11-11T13:00:00.000Z']], paymentDate: '2026-11-11T13:00:00.000Z',
  });
  const missing = await paid();
  await lead(v.visitId, v.visitorId, missing, '2026-11-11T12:10:00.000Z');
  const signalled = await paid();
  await lead(v.visitId, v.visitorId, signalled, '2026-11-11T12:10:00.000Z');
  await acquisitionEvent({ visitId: v.visitId, visitorId: v.visitorId, name: 'purchase', at: '2026-11-11T13:00:00.000Z', inscriptionId: signalled, eventId: `purchase_${signalled}`, source: 'server' });
  await paid(); // consenting but no lead: that is INSCRIPTION_WITHOUT_VISIT, not this rule
  await paid(false); // not consenting: no journey is expected

  const rule = await ruleOf('PAYMENT_WITHOUT_PURCHASE_SIGNAL', FRESH);
  assert.deepEqual([rule?.severity, rule?.affected, rule?.universe], ['warning', 1, 2]);
});

test('INSCRIPTION_WITHOUT_VISIT only counts consenting inscriptions that have no lead event', async () => {
  const [v] = await visits(1);
  const linked = await inscription({ createdAt: '2026-11-11T12:10:00.000Z', price: 1000, status: 'pending', consent: true });
  await lead(v.visitId, v.visitorId, linked, '2026-11-11T12:10:00.000Z');
  await inscription({ createdAt: '2026-11-11T12:20:00.000Z', price: 1000, status: 'pending', consent: true });
  await inscription({ createdAt: '2026-11-11T12:30:00.000Z', price: 1000, status: 'pending', consent: false });
  const rule = await ruleOf('INSCRIPTION_WITHOUT_VISIT', FRESH);
  assert.deepEqual([rule?.affected, rule?.universe, rule?.percentage], [1, 2, 0.5]);
});

test('CAPI_PENDING_TOO_LONG and CAPI_EXHAUSTED, plus the status breakdown', async () => {
  await capiAttempt({ eventId: 'old-retry', status: 'retry', at: '2026-11-11T12:00:00.000Z', updatedAt: '2026-11-15T12:00:00.000Z' });
  await capiAttempt({ eventId: 'fresh-accepted', status: 'accepted', at: '2026-11-11T12:00:00.000Z', updatedAt: '2026-11-18T11:00:00.000Z' });
  await capiAttempt({ eventId: 'dead', status: 'exhausted', at: '2026-11-12T12:00:00.000Z' });
  await capiAttempt({ eventId: 'ok', status: 'delivered', at: '2026-11-12T12:00:00.000Z' });

  const result = await report();
  const pending = result.data.rules.find((rule) => rule.code === 'CAPI_PENDING_TOO_LONG');
  assert.deepEqual([pending?.affected, pending?.universe], [1, 4]);
  const exhausted = result.data.rules.find((rule) => rule.code === 'CAPI_EXHAUSTED');
  assert.deepEqual([exhausted?.severity, exhausted?.affected], ['critical', 1]);
  assert.deepEqual(result.data.capi, { accepted: 1, delivered: 1, pending: 0, retry: 1, exhausted: 1 });
});

test('TRACKING_STALE: recent activity is fine, old or missing activity is flagged', async () => {
  assert.equal((await ruleOf('TRACKING_STALE', FRESH))?.severity, 'warning', 'no data at all');
  const [v] = await visits(1);
  await acquisitionEvent({ visitId: v.visitId, visitorId: v.visitorId, name: 'page_view', at: '2026-11-11T12:00:30.000Z' });
  assert.equal(await ruleOf('TRACKING_STALE', FRESH), undefined);
  const stale = await getQualityReport(query(), NOW);
  assert.equal(stale.data.tracking.stale, true);
  assert.ok(stale.data.tracking.lastActivityAt);
});

test('identifier coverage counts visits that kept fbc/fbp flags', async () => {
  await visits(3, { hasFbc: true });
  await visits(1);
  const { identifiers } = (await report(FRESH)).data;
  assert.deepEqual([identifiers.visits, identifiers.withFbc, identifiers.fbcCoverage], [4, 3, 0.75]);
});

test('rules carry an explanation and action, and the report holds no personal data', async () => {
  await visits(3, { channel: 'unknown' });
  const result = await report(FRESH);
  for (const rule of result.data.rules) assert.ok(rule.explanation.length > 10 && rule.action.length > 10, rule.code);
  const serialized = JSON.stringify(result);
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(serialized));
});
