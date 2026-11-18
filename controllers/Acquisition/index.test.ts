import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';
import { rateLimit } from 'express-rate-limit';
import type { RequestHandler } from 'express';
import express from 'express';
import { createAcquisitionRouter } from '../../routes/Acquisition/index.js';
import { handleAcquisitionError } from './index.js';
import AcquisitionEvent from '../../models/AcquisitionEvent/index.js';
import AcquisitionSignalAttempt from '../../models/AcquisitionSignalAttempt/index.js';
import AcquisitionVisit from '../../models/AcquisitionVisit/index.js';
import { recordMetaMarketingConsent } from '../../services/privacy/marketingConsent.js';
import { META_MARKETING_CONSENT_VERSION } from '../../utils/metaMarketingConsent.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { startTestServer } from '../../utils/testing/httpServer.js';
import type { TestServer } from '../../utils/testing/httpServer.js';

const passthrough: RequestHandler = (_req, _res, next) => next();
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const HOUR = 60 * 60 * 1000;

let stopDb: () => Promise<void>;
let server: TestServer;

before(async () => {
  stopDb = await startTestDb();
  await Promise.all([AcquisitionVisit.init(), AcquisitionEvent.init(), AcquisitionSignalAttempt.init()]);
  server = await startTestServer((app) => app.use('/api/acquisition', createAcquisitionRouter(passthrough)));
});
after(async () => {
  await server.close();
  await stopDb();
});
beforeEach(async () => {
  process.env.ACQUISITION_TRACKING_ENABLED = 'true';
  process.env.CORS_ORIGIN = 'https://modista-app.com';
  await Promise.all([AcquisitionVisit.deleteMany({}), AcquisitionEvent.deleteMany({}), AcquisitionSignalAttempt.deleteMany({})]);
});

const consentedVisitor = async (): Promise<string> => {
  const visitorId = randomUUID();
  await recordMetaMarketingConsent(visitorId, true);
  return visitorId;
};

const consentHeaders = (visitorId: string, overrides: Record<string, string> = {}) => ({
  'x-meta-consent': 'granted',
  'x-meta-consent-version': META_MARKETING_CONSENT_VERSION,
  'x-session-id': visitorId,
  ...overrides,
});

const visitBody = (visitorId: string, overrides: Record<string, unknown> = {}) => ({
  visitId: randomUUID(),
  visitorId,
  startedAt: iso(-60_000),
  lastActivityAt: iso(-30_000),
  entryPath: '/lp/curso',
  landingSlug: 'curso',
  referrer: 'https://l.instagram.com/?u=secret-token',
  utm: { source: 'instagram', medium: 'social', campaign: 'bio' },
  device: 'mobile',
  ...overrides,
});

const eventBody = (visitorId: string, visitId: string, overrides: Record<string, unknown> = {}) => ({
  eventId: randomUUID(),
  visitId,
  visitorId,
  name: 'cta_click',
  occurredAt: iso(-1_000),
  path: '/lp/curso',
  courseId: 'course-1',
  ...overrides,
});

const signalBody = (visitorId: string, visitId: string, overrides: Record<string, unknown> = {}) => ({
  eventId: randomUUID(),
  visitId,
  visitorId,
  channel: 'browser_pixel',
  status: 'invoked',
  occurredAt: iso(-1_000),
  ...overrides,
});

const counts = async () => ({
  visits: await AcquisitionVisit.countDocuments(),
  events: await AcquisitionEvent.countDocuments(),
  signals: await AcquisitionSignalAttempt.countDocuments(),
});

// ---------- gating: flag and consent ----------

test('every endpoint is a silent no-op (204) while the feature flag is off', async () => {
  process.env.ACQUISITION_TRACKING_ENABLED = 'false';
  const visitorId = await consentedVisitor();
  const visit = visitBody(visitorId);
  const headers = consentHeaders(visitorId);
  assert.equal((await server.post('/api/acquisition/visits', visit, headers)).status, 204);
  assert.equal((await server.post('/api/acquisition/events', eventBody(visitorId, visit.visitId), headers)).status, 204);
  assert.equal((await server.post('/api/acquisition/signals/browser', signalBody(visitorId, visit.visitId), headers)).status, 204);
  assert.deepEqual(await counts(), { visits: 0, events: 0, signals: 0 });
});

test('without current consent nothing identifiable is created (204)', async () => {
  const visitorId = await consentedVisitor();
  const stranger = randomUUID();
  const visit = visitBody(visitorId);
  const cases: Array<[string, Record<string, string>]> = [
    ['no headers', {}],
    ['consent not granted', consentHeaders(visitorId, { 'x-meta-consent': 'denied' })],
    ['old policy version', consentHeaders(visitorId, { 'x-meta-consent-version': 'old' })],
    ['no consent record for the session', consentHeaders(stranger)],
  ];
  for (const [label, headers] of cases) {
    const body = headers['x-session-id'] === stranger ? visitBody(stranger) : visit;
    assert.equal((await server.post('/api/acquisition/visits', body, headers)).status, 204, label);
    assert.equal((await server.post('/api/acquisition/events', eventBody(body.visitorId, body.visitId), headers)).status, 204, label);
    assert.equal((await server.post('/api/acquisition/signals/browser', signalBody(body.visitorId, body.visitId), headers)).status, 204, label);
  }
  assert.deepEqual(await counts(), { visits: 0, events: 0, signals: 0 });
});

test('a body visitorId that differs from the consented X-Session-Id is rejected (400)', async () => {
  const visitorId = await consentedVisitor();
  const other = randomUUID();
  const headers = consentHeaders(visitorId);
  const visit = visitBody(other);
  assert.equal((await server.post('/api/acquisition/visits', visit, headers)).status, 400);
  assert.equal((await server.post('/api/acquisition/events', eventBody(other, visit.visitId), headers)).status, 400);
  assert.equal((await server.post('/api/acquisition/signals/browser', signalBody(other, visit.visitId), headers)).status, 400);
  assert.deepEqual(await counts(), { visits: 0, events: 0, signals: 0 });
});

// ---------- visits ----------

test('creates a visit (201) classified server-side; client classification and referrer detail are ignored', async () => {
  const visitorId = await consentedVisitor();
  const body = visitBody(visitorId, { classification: { channelGroup: 'meta_paid' }, hasFbc: true });
  const response = await server.post('/api/acquisition/visits', body, consentHeaders(visitorId));
  assert.equal(response.status, 201);
  assert.deepEqual(response.body, { success: true });

  const saved = await AcquisitionVisit.findOne({ visitId: body.visitId }).lean();
  assert.equal(saved?.classification.channelGroup, 'instagram_organic');
  assert.equal(saved?.classification.classifierVersion, 1);
  assert.equal(saved?.referrerHost, 'l.instagram.com');
  assert.equal(saved?.rawAttribution.campaign, 'bio');
  assert.equal(saved?.consentVersion, META_MARKETING_CONSENT_VERSION);
  assert.equal(saved?.device, 'mobile');
  assert.equal(saved?.hasFbc, true);
  assert.ok(!JSON.stringify(saved).includes('secret-token'));
});

test('repeating a visit (200) only advances lastActivityAt and never reclassifies', async () => {
  const visitorId = await consentedVisitor();
  const headers = consentHeaders(visitorId);
  const first = visitBody(visitorId);
  await server.post('/api/acquisition/visits', first, headers);

  const later = { ...first, lastActivityAt: iso(-1_000), utm: { source: 'instagram', medium: 'cpc' } };
  assert.equal((await server.post('/api/acquisition/visits', later, headers)).status, 200);
  const older = { ...first, lastActivityAt: iso(-50_000) };
  assert.equal((await server.post('/api/acquisition/visits', older, headers)).status, 200);

  assert.equal(await AcquisitionVisit.countDocuments(), 1);
  const saved = await AcquisitionVisit.findOne({ visitId: first.visitId }).lean();
  assert.equal(saved?.classification.channelGroup, 'instagram_organic');
  assert.equal(saved?.startedAt.toISOString(), first.startedAt);
  assert.equal(saved?.lastActivityAt.toISOString(), later.lastActivityAt);
});

test('a visitId already owned by another visitor is a conflict (409) and stays untouched', async () => {
  const owner = await consentedVisitor();
  const intruder = await consentedVisitor();
  const original = visitBody(owner);
  await server.post('/api/acquisition/visits', original, consentHeaders(owner));

  const hijack = visitBody(intruder, { visitId: original.visitId, lastActivityAt: iso(-1_000) });
  assert.equal((await server.post('/api/acquisition/visits', hijack, consentHeaders(intruder))).status, 409);

  const saved = await AcquisitionVisit.findOne({ visitId: original.visitId }).lean();
  assert.equal(saved?.visitorId, owner);
  assert.equal(saved?.lastActivityAt.toISOString(), original.lastActivityAt);
});

test('rejects invalid visit contracts with 400 and without echoing values', async () => {
  const visitorId = await consentedVisitor();
  const headers = consentHeaders(visitorId);
  const invalid: Array<[string, Record<string, unknown>]> = [
    ['visitId not a uuid', { visitId: 'visit-1' }],
    ['entryPath not site-relative', { entryPath: 'https://evil.com/x' }],
    ['startedAt in the future', { startedAt: iso(HOUR), lastActivityAt: iso(HOUR) }],
    ['timestamps too old', { startedAt: iso(-72 * HOUR), lastActivityAt: iso(-72 * HOUR) }],
    ['lastActivityAt before startedAt', { startedAt: iso(-1_000), lastActivityAt: iso(-60_000) }],
    ['oversized utm value', { utm: { source: 'x'.repeat(200) } }],
    ['unknown device', { device: 'smart-fridge' }],
    ['malformed date', { startedAt: 'yesterday' }],
  ];
  const stringValues = (value: unknown): string[] =>
    typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(stringValues) : [];
  for (const [label, overrides] of invalid) {
    const response = await server.post('/api/acquisition/visits', visitBody(visitorId, overrides), headers);
    assert.equal(response.status, 400, label);
    const echoed = JSON.stringify(response.body);
    for (const value of stringValues(overrides)) assert.ok(!echoed.includes(value), `${label}: echoed ${value}`);
  }
  assert.equal(await AcquisitionVisit.countDocuments(), 0);
});

test('strips query strings and unknown UTM keys instead of storing them', async () => {
  const visitorId = await consentedVisitor();
  const body = visitBody(visitorId, {
    entryPath: '/lp/curso?email=a@b.com&fbclid=abc#x',
    utm: { source: 'instagram', medium: 'social', fbclid: 'abc', email: 'a@b.com' },
  });
  assert.equal((await server.post('/api/acquisition/visits', body, consentHeaders(visitorId))).status, 201);
  const saved = await AcquisitionVisit.findOne({ visitId: body.visitId }).lean();
  assert.equal(saved?.entryPath, '/lp/curso');
  assert.deepEqual(Object.keys(saved?.rawAttribution ?? {}).sort(), ['medium', 'source']);
});

test('a query hidden behind a line break never reaches the database', async () => {
  const visitorId = await consentedVisitor();
  const headers = consentHeaders(visitorId);
  const visit = visitBody(visitorId, { entryPath: '/lp/curso?email=a@b.com\nx' });
  assert.equal((await server.post('/api/acquisition/visits', visit, headers)).status, 201);
  const event = eventBody(visitorId, visit.visitId, { path: '/lp/curso#a\rb' });
  assert.equal((await server.post('/api/acquisition/events', event, headers)).status, 201);
  assert.equal((await AcquisitionVisit.findOne({ visitId: visit.visitId }).lean())?.entryPath, '/lp/curso');
  assert.equal((await AcquisitionEvent.findOne({ eventId: event.eventId }).lean())?.path, '/lp/curso');
  const control = visitBody(visitorId, { entryPath: '/lp\nfoo' });
  assert.equal((await server.post('/api/acquisition/visits', control, headers)).status, 400);
});

test('own-site and payment-gateway referrers do not turn into referral traffic', async () => {
  const visitorId = await consentedVisitor();
  const headers = consentHeaders(visitorId);
  for (const referrer of ['https://modista-app.com/lp/otro', 'https://www.mercadopago.com.ar/checkout']) {
    const body = visitBody(visitorId, { referrer, utm: undefined });
    assert.equal((await server.post('/api/acquisition/visits', body, headers)).status, 201);
    const saved = await AcquisitionVisit.findOne({ visitId: body.visitId }).lean();
    assert.equal(saved?.classification.channelGroup, 'direct', referrer);
    assert.equal(saved?.referrerHost, undefined, referrer);
  }
});

// ---------- events ----------

test('records a public event once (201, then 200) and never persists value or inscriptionId', async () => {
  const visitorId = await consentedVisitor();
  const headers = consentHeaders(visitorId);
  const visit = visitBody(visitorId);
  await server.post('/api/acquisition/visits', visit, headers);

  const body = eventBody(visitorId, visit.visitId, { value: 999999, inscriptionId: 'abc', path: '/lp/curso?email=a@b.com' });
  assert.equal((await server.post('/api/acquisition/events', body, headers)).status, 201);
  assert.equal((await server.post('/api/acquisition/events', body, headers)).status, 200);

  assert.equal(await AcquisitionEvent.countDocuments(), 1);
  const saved = await AcquisitionEvent.findOne({ eventId: body.eventId }).lean();
  assert.equal(saved?.source, 'browser');
  assert.equal(saved?.path, '/lp/curso');
  assert.equal(saved?.value, undefined);
  assert.equal(saved?.inscriptionId, undefined);
});

test('commercial event names can only be created by the server (400)', async () => {
  const visitorId = await consentedVisitor();
  const headers = consentHeaders(visitorId);
  const visit = visitBody(visitorId);
  for (const name of ['lead', 'purchase', 'initiate_checkout', 'purchase_confirmation', '']) {
    const response = await server.post('/api/acquisition/events', eventBody(visitorId, visit.visitId, { name }), headers);
    assert.equal(response.status, 400, name);
  }
  for (const name of ['page_view', 'course_detail_view', 'pricing_visible', 'cta_click', 'form_view', 'form_start', 'form_submit', 'redirect_to_payment', 'scroll_50', 'scroll_90']) {
    const response = await server.post('/api/acquisition/events', eventBody(visitorId, visit.visitId, { name }), headers);
    assert.equal(response.status, 201, name);
  }
});

test('an event may arrive before its visit (orphan, 201) but never for another visitor’s visit (409)', async () => {
  const owner = await consentedVisitor();
  const other = await consentedVisitor();
  const visit = visitBody(owner);
  await server.post('/api/acquisition/visits', visit, consentHeaders(owner));

  const orphan = eventBody(other, randomUUID());
  assert.equal((await server.post('/api/acquisition/events', orphan, consentHeaders(other))).status, 201);

  const crossed = eventBody(other, visit.visitId);
  assert.equal((await server.post('/api/acquisition/events', crossed, consentHeaders(other))).status, 409);
  assert.equal(await AcquisitionEvent.countDocuments({ eventId: crossed.eventId }), 0);
});

test('an eventId already recorded for another visitor is a conflict and keeps its owner', async () => {
  const owner = await consentedVisitor();
  const intruder = await consentedVisitor();
  const original = eventBody(owner, randomUUID());
  await server.post('/api/acquisition/events', original, consentHeaders(owner));

  const squat = { ...original, visitorId: intruder, visitId: randomUUID() };
  assert.equal((await server.post('/api/acquisition/events', squat, consentHeaders(intruder))).status, 409);
  assert.equal((await AcquisitionEvent.findOne({ eventId: original.eventId }).lean())?.visitorId, owner);
});

test('an event advances the lastActivityAt of its visit', async () => {
  const visitorId = await consentedVisitor();
  const headers = consentHeaders(visitorId);
  const visit = visitBody(visitorId);
  await server.post('/api/acquisition/visits', visit, headers);
  const occurredAt = iso(-500);
  await server.post('/api/acquisition/events', eventBody(visitorId, visit.visitId, { occurredAt }), headers);
  const saved = await AcquisitionVisit.findOne({ visitId: visit.visitId }).lean();
  assert.equal(saved?.lastActivityAt.toISOString(), occurredAt);
});

test('rejects invalid event contracts (400)', async () => {
  const visitorId = await consentedVisitor();
  const headers = consentHeaders(visitorId);
  const visitId = randomUUID();
  const invalid: Array<[string, Record<string, unknown>]> = [
    ['eventId with spaces', { eventId: 'has spaces' }],
    ['eventId too short', { eventId: 'x' }],
    ['visitId not a uuid', { visitId: 'nope' }],
    ['occurredAt in the future', { occurredAt: iso(HOUR) }],
    ['occurredAt too old', { occurredAt: iso(-72 * HOUR) }],
    ['path not site-relative', { path: 'https://evil.com' }],
    ['courseId with symbols', { courseId: '<script>' }],
  ];
  for (const [label, overrides] of invalid) {
    const response = await server.post('/api/acquisition/events', eventBody(visitorId, visitId, overrides), headers);
    assert.equal(response.status, 400, label);
  }
  assert.equal(await AcquisitionEvent.countDocuments(), 0);
});

// ---------- browser signals ----------

test('registers a browser pixel invocation once (201, then 200) without double counting', async () => {
  const visitorId = await consentedVisitor();
  const headers = consentHeaders(visitorId);
  const body = signalBody(visitorId, randomUUID());
  assert.equal((await server.post('/api/acquisition/signals/browser', body, headers)).status, 201);
  assert.equal((await server.post('/api/acquisition/signals/browser', body, headers)).status, 200);

  const rows = await AcquisitionSignalAttempt.find({ eventId: body.eventId }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channel, 'browser_pixel');
  assert.equal(rows[0].status, 'invoked');
  assert.equal(rows[0].attempts, 1);
});

test('a signal cannot take over another visitor’s eventId or visit', async () => {
  const owner = await consentedVisitor();
  const intruder = await consentedVisitor();
  const visit = visitBody(owner);
  await server.post('/api/acquisition/visits', visit, consentHeaders(owner));
  const original = signalBody(owner, visit.visitId);
  await server.post('/api/acquisition/signals/browser', original, consentHeaders(owner));

  const squat = { ...original, visitorId: intruder, visitId: randomUUID() };
  assert.equal((await server.post('/api/acquisition/signals/browser', squat, consentHeaders(intruder))).status, 409);
  assert.equal((await AcquisitionSignalAttempt.findOne({ eventId: original.eventId }).lean())?.visitorId, owner);

  const foreignVisit = signalBody(intruder, visit.visitId);
  assert.equal((await server.post('/api/acquisition/signals/browser', foreignVisit, consentHeaders(intruder))).status, 409);
});

test('the public signal endpoint can only write browser_pixel/invoked', async () => {
  const visitorId = await consentedVisitor();
  const headers = consentHeaders(visitorId);
  const visitId = randomUUID();
  for (const overrides of [{ status: 'delivered' }, { status: 'accepted' }, { channel: 'server_capi' }, { channel: 'server_capi', status: 'accepted' }]) {
    const response = await server.post('/api/acquisition/signals/browser', signalBody(visitorId, visitId, overrides), headers);
    assert.equal(response.status, 400, JSON.stringify(overrides));
  }
  assert.equal(await AcquisitionSignalAttempt.countDocuments(), 0);
});

// ---------- rate limit ----------

test('the rate limiter protects all three public endpoints', async () => {
  const limited = await startTestServer((app) =>
    app.use('/api/acquisition', createAcquisitionRouter(rateLimit({ windowMs: 60_000, limit: 2, validate: false }))),
  );
  try {
    const visitorId = randomUUID();
    const visit = visitBody(visitorId);
    assert.equal((await limited.post('/api/acquisition/visits', visit, {})).status, 204);
    assert.equal((await limited.post('/api/acquisition/visits', visit, {})).status, 204);
    assert.equal((await limited.post('/api/acquisition/visits', visit, {})).status, 429);
    assert.equal((await limited.post('/api/acquisition/events', eventBody(visitorId, visit.visitId), {})).status, 429);
    assert.equal((await limited.post('/api/acquisition/signals/browser', signalBody(visitorId, visit.visitId), {})).status, 429);
  } finally {
    await limited.close();
  }
});

test('unexpected errors answer a generic 500 without echoing the error message', async () => {
  const failing = await startTestServer((app) => {
    const router = express.Router();
    router.post('/boom', () => {
      throw new Error('E11000 duplicate key { entryPath: "/lp?email=a@b.com" }');
    });
    router.use(handleAcquisitionError);
    app.use('/api/acquisition', router);
  });
  try {
    const response = await failing.post('/api/acquisition/boom', {}, {});
    assert.equal(response.status, 500);
    assert.ok(!JSON.stringify(response.body).includes('a@b.com'));
  } finally {
    await failing.close();
  }
});
