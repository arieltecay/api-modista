import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import AcquisitionSignalAttempt from './index.js';
import { isStatusValidForChannel } from './types.js';
import { listIndexKeys, startTestDb } from '../../utils/testing/mongoMemoryServer.js';

let stopDb: () => Promise<void>;

before(async () => {
  stopDb = await startTestDb();
  await AcquisitionSignalAttempt.init();
});
after(async () => stopDb());
beforeEach(async () => {
  await AcquisitionSignalAttempt.deleteMany({});
});

const pixelAttempt = (overrides: Record<string, unknown> = {}) => ({
  eventId: 'event-1',
  visitorId: 'visitor-1',
  visitId: 'visit-1',
  channel: 'browser_pixel',
  status: 'invoked',
  occurredAt: new Date('2026-11-18T10:00:00.000Z'),
  ...overrides,
});

const capiAttempt = (overrides: Record<string, unknown> = {}) => ({
  eventId: 'event-1',
  channel: 'server_capi',
  status: 'accepted',
  occurredAt: new Date('2026-11-18T10:00:00.000Z'),
  ...overrides,
});

test('stores pixel and CAPI attempts for the same eventId as separate rows', async () => {
  await AcquisitionSignalAttempt.create(pixelAttempt());
  await AcquisitionSignalAttempt.create(capiAttempt());
  assert.equal(await AcquisitionSignalAttempt.countDocuments({ eventId: 'event-1' }), 2);
});

test('rejects a duplicate { eventId, channel }', async () => {
  await AcquisitionSignalAttempt.create(pixelAttempt());
  await assert.rejects(AcquisitionSignalAttempt.create(pixelAttempt()), { code: 11000 });
});

test('browser_pixel requires visitorId and visitId; server_capi may omit them', async () => {
  await assert.rejects(AcquisitionSignalAttempt.create(pixelAttempt({ visitorId: undefined })), { name: 'ValidationError' });
  await assert.rejects(AcquisitionSignalAttempt.create(pixelAttempt({ eventId: 'e2', visitId: undefined })), { name: 'ValidationError' });
  const saved = await AcquisitionSignalAttempt.create(capiAttempt({ eventId: 'e3' }));
  assert.equal(saved.attempts, 0);
});

test('browser_pixel can only be invoked, never accepted or delivered (on create/save)', async () => {
  for (const status of ['accepted', 'delivered', 'pending', 'retry', 'exhausted']) {
    await assert.rejects(AcquisitionSignalAttempt.create(pixelAttempt({ eventId: `e-${status}`, status })), { name: 'ValidationError' }, status);
  }
});

test('server_capi accepts its lifecycle statuses and rejects invoked and unknown ones', async () => {
  for (const status of ['accepted', 'delivered', 'pending', 'retry', 'exhausted']) {
    await AcquisitionSignalAttempt.create(capiAttempt({ eventId: `e-${status}`, status }));
  }
  await assert.rejects(AcquisitionSignalAttempt.create(capiAttempt({ eventId: 'x1', status: 'invoked' })), { name: 'ValidationError' });
  await assert.rejects(AcquisitionSignalAttempt.create(capiAttempt({ eventId: 'x2', status: 'sent' })), { name: 'ValidationError' });
});

test('rejects an unknown channel and does not persist payloads', async () => {
  await assert.rejects(AcquisitionSignalAttempt.create(capiAttempt({ eventId: 'x3', channel: 'sms' })), { name: 'ValidationError' });
  await AcquisitionSignalAttempt.create(capiAttempt({ eventId: 'x4', payload: { email: 'a@b.com' } }));
  const saved = await AcquisitionSignalAttempt.findOne({ eventId: 'x4' }).lean();
  assert.equal('payload' in (saved ?? {}), false);
});

test('isStatusValidForChannel is the single source of truth for upserts, where schema validators do not run', () => {
  assert.equal(isStatusValidForChannel('browser_pixel', 'invoked'), true);
  for (const status of ['accepted', 'delivered', 'pending', 'retry', 'exhausted'] as const) {
    assert.equal(isStatusValidForChannel('browser_pixel', status), false, status);
    assert.equal(isStatusValidForChannel('server_capi', status), true, status);
  }
  assert.equal(isStatusValidForChannel('server_capi', 'invoked'), false);
});

test('creates the planned indexes (unique { eventId, channel } plus revocation and health lookups)', async () => {
  const keys = await listIndexKeys(AcquisitionSignalAttempt);
  const has = (key: Record<string, number>) => keys.some((k) => JSON.stringify(k) === JSON.stringify(key));
  assert.ok(has({ eventId: 1, channel: 1 }));
  assert.ok(has({ visitorId: 1 }));
  assert.ok(has({ occurredAt: -1, channel: 1, status: 1 }));
  const unique = (await AcquisitionSignalAttempt.collection.indexes()).find((i) => JSON.stringify(i.key) === JSON.stringify({ eventId: 1, channel: 1 }));
  assert.equal(unique?.unique, true);
});
