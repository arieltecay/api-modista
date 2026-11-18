import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import AcquisitionVisit from './index.js';
import { listIndexKeys, startTestDb } from '../../utils/testing/mongoMemoryServer.js';

let stopDb: () => Promise<void>;

before(async () => {
  stopDb = await startTestDb();
  await AcquisitionVisit.init();
});
after(async () => stopDb());
beforeEach(async () => {
  await AcquisitionVisit.deleteMany({});
});

const validVisit = (overrides: Record<string, unknown> = {}) => ({
  visitId: 'visit-1',
  visitorId: 'visitor-1',
  startedAt: new Date('2026-11-18T10:00:00.000Z'),
  lastActivityAt: new Date('2026-11-18T10:05:00.000Z'),
  entryPath: '/lp/curso',
  rawAttribution: { source: 'instagram', medium: 'social' },
  classification: {
    sourcePlatform: 'instagram',
    acquisitionType: 'organic_social',
    channelGroup: 'instagram_organic',
    reason: 'social_medium',
    classifierVersion: 1,
  },
  consentVersion: 'v1',
  ...overrides,
});

test('persists a visit with raw attribution and versioned classification', async () => {
  await AcquisitionVisit.create(validVisit());
  const saved = await AcquisitionVisit.findOne({ visitId: 'visit-1' }).lean();
  assert.equal(saved?.rawAttribution.source, 'instagram');
  assert.equal(saved?.classification.channelGroup, 'instagram_organic');
  assert.equal(saved?.classification.classifierVersion, 1);
  assert.equal(saved?.device, 'unknown');
  assert.equal(saved?.hasFbc, false);
  assert.equal(saved?.hasFbp, false);
  assert.ok(saved?.createdAt && saved.updatedAt);
});

test('rejects a duplicate visitId', async () => {
  await AcquisitionVisit.create(validVisit());
  await assert.rejects(AcquisitionVisit.create(validVisit()), { code: 11000 });
});

test('requires identity, timing, entry path, classification and consent version', async () => {
  for (const field of ['visitId', 'visitorId', 'startedAt', 'lastActivityAt', 'entryPath', 'classification', 'consentVersion']) {
    await assert.rejects(AcquisitionVisit.create(validVisit({ [field]: undefined })), { name: 'ValidationError' }, field);
  }
});

test('rejects an entry path carrying a query string or hash (could leak PII)', async () => {
  for (const entryPath of ['/lp/curso?email=a@b.com', '/lp/curso#frag', 'lp/curso']) {
    await assert.rejects(AcquisitionVisit.create(validVisit({ visitId: `p-${entryPath}`, entryPath })), { name: 'ValidationError' }, entryPath);
  }
});

test('rejects an invalid device', async () => {
  await assert.rejects(AcquisitionVisit.create(validVisit({ device: 'smart-fridge' })), { name: 'ValidationError' });
});

test('never persists PII or advertising identifiers that are not in the schema', async () => {
  await AcquisitionVisit.create(
    validVisit({ email: 'a@b.com', ip: '1.2.3.4', userAgent: 'UA', fbc: 'fb.1.x', fbp: 'fb.1.y', rawAttribution: { source: 'x', extra: 'y' } }),
  );
  const saved = await AcquisitionVisit.findOne({ visitId: 'visit-1' }).lean();
  for (const key of ['email', 'ip', 'userAgent', 'fbc', 'fbp']) assert.equal(key in (saved ?? {}), false, key);
  assert.equal('extra' in (saved?.rawAttribution ?? {}), false);
});

test('creates the planned indexes', async () => {
  const keys = await listIndexKeys(AcquisitionVisit);
  const expected = [
    { visitId: 1 },
    { visitorId: 1, startedAt: -1 },
    { startedAt: -1, 'classification.channelGroup': 1 },
    { 'rawAttribution.campaign': 1, startedAt: -1 },
    { landingSlug: 1, startedAt: -1 },
  ];
  for (const key of expected) assert.ok(keys.some((k) => JSON.stringify(k) === JSON.stringify(key)), JSON.stringify(key));
});
