import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import AcquisitionEvent from './index.js';
import { listIndexKeys, startTestDb } from '../../utils/testing/mongoMemoryServer.js';

let stopDb: () => Promise<void>;

before(async () => {
  stopDb = await startTestDb();
  await AcquisitionEvent.init();
});
after(async () => stopDb());
beforeEach(async () => {
  await AcquisitionEvent.deleteMany({});
});

const validEvent = (overrides: Record<string, unknown> = {}) => ({
  eventId: 'event-1',
  visitId: 'visit-1',
  visitorId: 'visitor-1',
  name: 'cta_click',
  occurredAt: new Date('2026-11-18T10:00:00.000Z'),
  source: 'browser',
  ...overrides,
});

test('persists an event and stamps receivedAt and schemaVersion', async () => {
  await AcquisitionEvent.create(validEvent({ path: '/lp/curso', courseId: 'c1' }));
  const saved = await AcquisitionEvent.findOne({ eventId: 'event-1' }).lean();
  assert.equal(saved?.name, 'cta_click');
  assert.equal(saved?.path, '/lp/curso');
  assert.ok(saved?.receivedAt instanceof Date);
  assert.equal(saved?.schemaVersion, 1);
});

test('rejects a duplicate eventId', async () => {
  await AcquisitionEvent.create(validEvent());
  await assert.rejects(AcquisitionEvent.create(validEvent({ visitId: 'visit-2' })), { code: 11000 });
});

test('accepts every planned event name and rejects unknown ones', async () => {
  const names = [
    'page_view', 'course_detail_view', 'pricing_visible', 'cta_click', 'form_view', 'form_start', 'form_submit',
    'lead', 'initiate_checkout', 'redirect_to_payment', 'purchase', 'scroll_50', 'scroll_90',
  ];
  for (const name of names) await AcquisitionEvent.create(validEvent({ eventId: `e-${name}`, name }));
  await assert.rejects(AcquisitionEvent.create(validEvent({ eventId: 'e-bad', name: 'purchase_confirmation' })), { name: 'ValidationError' });
});

test('restricts source and currency', async () => {
  await assert.rejects(AcquisitionEvent.create(validEvent({ eventId: 'e1', source: 'cron' })), { name: 'ValidationError' });
  await assert.rejects(AcquisitionEvent.create(validEvent({ eventId: 'e2', currency: 'USD' })), { name: 'ValidationError' });
  await AcquisitionEvent.create(validEvent({ eventId: 'e3', source: 'server', currency: 'ARS', value: 1500 }));
});

test('requires identity, name, time and source', async () => {
  for (const field of ['eventId', 'visitId', 'visitorId', 'name', 'occurredAt', 'source']) {
    await assert.rejects(AcquisitionEvent.create(validEvent({ [field]: undefined })), { name: 'ValidationError' }, field);
  }
});

test('drops open-ended properties and PII instead of persisting them', async () => {
  await AcquisitionEvent.create(validEvent({ properties: { email: 'a@b.com' }, email: 'a@b.com', phone: '123' }));
  const saved = await AcquisitionEvent.findOne({ eventId: 'event-1' }).lean();
  for (const key of ['properties', 'email', 'phone']) assert.equal(key in (saved ?? {}), false, key);
});

test('rejects a path carrying a query string or hash (could leak PII)', async () => {
  for (const path of ['/lp/curso?email=a@b.com', '/lp/curso#frag', 'lp/curso']) {
    await assert.rejects(AcquisitionEvent.create(validEvent({ eventId: `p-${path}`, path })), { name: 'ValidationError' }, path);
  }
  await AcquisitionEvent.create(validEvent({ eventId: 'p-ok', path: '/lp/curso' }));
});

test('creates the planned indexes', async () => {
  const keys = await listIndexKeys(AcquisitionEvent);
  const expected = [
    { eventId: 1 },
    { visitId: 1, occurredAt: 1 },
    { name: 1, occurredAt: -1 },
    { inscriptionId: 1, name: 1 },
    { courseId: 1, occurredAt: -1 },
    { visitorId: 1 },
  ];
  for (const key of expected) assert.ok(keys.some((k) => JSON.stringify(k) === JSON.stringify(key)), JSON.stringify(key));
});
