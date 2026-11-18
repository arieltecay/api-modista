import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import AcquisitionSignalAttempt from '../../models/AcquisitionSignalAttempt/index.js';
import MetaEventDlq from '../../models/MetaEventDlq.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { purgeVisitorData } from './index.js';
import { mapOutboxStatus, reconcileCapiSignals, recordServerCapiStatus } from './signals.js';

let stopDb: () => Promise<void>;

before(async () => {
  stopDb = await startTestDb();
  await Promise.all([AcquisitionSignalAttempt.init(), MetaEventDlq.init()]);
});
after(async () => stopDb());
beforeEach(async () => {
  await Promise.all([AcquisitionSignalAttempt.deleteMany({}), MetaEventDlq.deleteMany({})]);
});

const at = new Date('2026-11-18T10:00:00.000Z');
const capi = (eventId: string) => AcquisitionSignalAttempt.findOne({ eventId, channel: 'server_capi' }).lean();

test('maps the outbox status to the signal status', () => {
  assert.equal(mapOutboxStatus({ status: 'sent', attempts: 1 }), 'delivered');
  assert.equal(mapOutboxStatus({ status: 'exhausted', attempts: 5 }), 'exhausted');
  assert.equal(mapOutboxStatus({ status: 'failed', attempts: 2 }), 'exhausted');
  assert.equal(mapOutboxStatus({ status: 'pending', attempts: 0 }), 'pending');
  assert.equal(mapOutboxStatus({ status: 'pending', attempts: 2 }), 'retry');
});

test('creates a server_capi attempt and advances it forward only', async () => {
  const base = { eventId: 'purchase_1', occurredAt: at, visitorId: 'visitor-1' };
  await recordServerCapiStatus({ ...base, status: 'accepted' });
  assert.equal((await capi('purchase_1'))?.status, 'accepted');
  assert.equal((await capi('purchase_1'))?.visitorId, 'visitor-1');

  await recordServerCapiStatus({ ...base, status: 'retry', attempts: 2 });
  assert.equal((await capi('purchase_1'))?.status, 'retry');
  assert.equal((await capi('purchase_1'))?.attempts, 2);

  await recordServerCapiStatus({ ...base, status: 'pending', attempts: 1 });
  assert.equal((await capi('purchase_1'))?.status, 'retry', 'must not regress');
  assert.equal((await capi('purchase_1'))?.attempts, 2, 'attempts never decrease');

  await recordServerCapiStatus({ ...base, status: 'delivered' });
  assert.equal((await capi('purchase_1'))?.status, 'delivered');
  assert.equal(await AcquisitionSignalAttempt.countDocuments({ eventId: 'purchase_1' }), 1);
});

test('terminal states never change', async () => {
  const base = { occurredAt: at };
  await recordServerCapiStatus({ ...base, eventId: 'a', status: 'delivered' });
  await recordServerCapiStatus({ ...base, eventId: 'a', status: 'exhausted' });
  await recordServerCapiStatus({ ...base, eventId: 'a', status: 'accepted' });
  assert.equal((await capi('a'))?.status, 'delivered');

  await recordServerCapiStatus({ ...base, eventId: 'b', status: 'exhausted' });
  await recordServerCapiStatus({ ...base, eventId: 'b', status: 'delivered' });
  assert.equal((await capi('b'))?.status, 'exhausted');
});

test('never touches the browser_pixel row of the same eventId', async () => {
  await AcquisitionSignalAttempt.create({
    eventId: 'e1', visitorId: 'v', visitId: 'vi', channel: 'browser_pixel', status: 'invoked', occurredAt: at,
  });
  await recordServerCapiStatus({ eventId: 'e1', status: 'delivered', occurredAt: at });
  const pixel = await AcquisitionSignalAttempt.findOne({ eventId: 'e1', channel: 'browser_pixel' }).lean();
  assert.equal(pixel?.status, 'invoked');
  assert.equal(await AcquisitionSignalAttempt.countDocuments({ eventId: 'e1' }), 2);
});

test('rejects statuses that are not valid for server_capi without writing', async () => {
  await recordServerCapiStatus({ eventId: 'x', status: 'invoked' as never, occurredAt: at });
  assert.equal(await AcquisitionSignalAttempt.countDocuments({ eventId: 'x' }), 0);
});

const dlq = (eventId: string, status: string, attempts: number) =>
  MetaEventDlq.create({ eventName: 'Purchase', eventId, status, attempts, payload: { externalId: 'secret-visitor', email: 'a@b.com' } });

test('reconciles the outbox into existing attempts without copying payloads, idempotently', async () => {
  for (const id of ['purchase_sent', 'purchase_retry', 'purchase_dead']) {
    await recordServerCapiStatus({ eventId: id, status: 'accepted', occurredAt: at, visitorId: 'v' });
  }
  await dlq('purchase_sent', 'sent', 1);
  await dlq('purchase_retry', 'pending', 3);
  await dlq('purchase_dead', 'exhausted', 5);

  assert.equal((await reconcileCapiSignals({ since: new Date(0) })).processed, 3);
  assert.equal((await capi('purchase_sent'))?.status, 'delivered');
  assert.equal((await capi('purchase_retry'))?.status, 'retry');
  assert.equal((await capi('purchase_dead'))?.status, 'exhausted');

  const stored = JSON.stringify(await AcquisitionSignalAttempt.find().lean());
  assert.ok(!stored.includes('a@b.com') && !stored.includes('secret-visitor'));

  await reconcileCapiSignals({ since: new Date(0) });
  assert.equal(await AcquisitionSignalAttempt.countDocuments(), 3);
});

test('reconciliation never creates attempts, so it cannot resurrect data purged by a revocation', async () => {
  await recordServerCapiStatus({ eventId: 'purchase_gone', status: 'accepted', occurredAt: at, visitorId: 'revoked-visitor' });
  await dlq('purchase_gone', 'sent', 1);
  await dlq('purchase_never_mirrored', 'sent', 1);

  await purgeVisitorData('revoked-visitor');
  await reconcileCapiSignals({ since: new Date(0) });
  assert.equal(await AcquisitionSignalAttempt.countDocuments(), 0);
});

test('reconciliation repairs a lagging attempt but never regresses one', async () => {
  await recordServerCapiStatus({ eventId: 'purchase_a', status: 'accepted', occurredAt: at, visitorId: 'v' });
  await recordServerCapiStatus({ eventId: 'purchase_b', status: 'delivered', occurredAt: at });
  await dlq('purchase_a', 'sent', 1);
  await dlq('purchase_b', 'pending', 1);

  await reconcileCapiSignals({ since: new Date(0) });
  assert.equal((await capi('purchase_a'))?.status, 'delivered');
  assert.equal((await capi('purchase_a'))?.visitorId, 'v');
  assert.equal((await capi('purchase_b'))?.status, 'delivered');
});

test('reconciliation honours the since window and processes the newest rows first when limited', async () => {
  for (const id of ['purchase_old', 'purchase_new']) await recordServerCapiStatus({ eventId: id, status: 'accepted', occurredAt: at });
  await dlq('purchase_old', 'sent', 1);
  await new Promise((resolve) => setTimeout(resolve, 15));
  await dlq('purchase_new', 'sent', 1);

  assert.equal((await reconcileCapiSignals({ since: new Date(Date.now() + 60_000) })).processed, 0);
  assert.equal((await reconcileCapiSignals({ since: new Date(0), limit: 1 })).processed, 1);
  assert.equal((await capi('purchase_new'))?.status, 'delivered');
  assert.equal((await capi('purchase_old'))?.status, 'accepted');
});
