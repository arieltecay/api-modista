import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, before, beforeEach } from 'node:test';
import AcquisitionEvent from '../../models/AcquisitionEvent/index.js';
import AcquisitionVisit from '../../models/AcquisitionVisit/index.js';
import { acquisitionEvent, visit } from '../../utils/testing/acquisitionFixtures.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { liveQuerySchema } from './filters.js';
import { getLiveReport } from './index.js';

const NOW = new Date('2026-11-18T12:00:00.000Z');

let stopDb: () => Promise<void>;

before(async () => {
  stopDb = await startTestDb();
  await Promise.all([AcquisitionVisit.init(), AcquisitionEvent.init()]);
});
after(async () => stopDb());
beforeEach(async () => {
  await Promise.all([AcquisitionVisit.deleteMany({}), AcquisitionEvent.deleteMany({})]);
});

const seedLive = async () => {
  const [v1, v2, v3, v4] = Array.from({ length: 4 }, () => randomUUID());
  const a = await visit({ visitorId: v1, at: '2026-11-18T11:00:00.000Z', channel: 'meta_paid', updatedAt: '2026-11-18T11:50:00.000Z' });
  const b = await visit({ visitorId: v2, at: '2026-11-18T11:00:00.000Z', channel: 'instagram_organic', updatedAt: '2026-11-18T11:59:00.000Z' });
  const c = await visit({ visitorId: v3, at: '2026-11-18T11:00:00.000Z', channel: 'direct', updatedAt: '2026-11-18T11:30:00.000Z' });
  await visit({ visitorId: v4, at: '2026-11-18T09:00:00.000Z', channel: 'direct', updatedAt: '2026-11-18T10:00:00.000Z' });

  const log = (visitId: string, visitorId: string, name: string, receivedAt: string, path?: string) =>
    acquisitionEvent({ visitId, visitorId, name, at: receivedAt, receivedAt, path });
  await log(b, v2, 'page_view', '2026-11-18T11:59:30.000Z', '/lp/curso');
  await log(b, v2, 'cta_click', '2026-11-18T11:59:10.000Z', '/lp/curso');
  await log(a, v1, 'page_view', '2026-11-18T11:58:00.000Z');
  await log(a, v1, 'form_view', '2026-11-18T11:50:00.000Z');
  await log(c, v3, 'page_view', '2026-11-18T11:40:00.000Z');
};

const query = (windowMinutes?: number) => liveQuerySchema.parse(windowMinutes === undefined ? {} : { windowMinutes: String(windowMinutes) });

test('defaults to a 15 minute window and only accepts 5, 15, 30 or 60', () => {
  assert.equal(query().windowMinutes, 15);
  for (const value of [5, 15, 30, 60]) assert.equal(query(value).windowMinutes, value);
  for (const value of ['0', '10', '120', 'abc']) assert.equal(liveQuerySchema.safeParse({ windowMinutes: value }).success, false, value);
});

test('counts visits touched and events received inside the window, by server time', async () => {
  await seedLive();
  const { data, windowMinutes } = await getLiveReport(query(15), NOW);
  assert.equal(windowMinutes, 15);
  assert.equal(data.activeVisits, 2);
  assert.equal(data.eventsInWindow, 4);
  assert.deepEqual(data.activeByChannel, [{ channelGroup: 'instagram_organic', count: 1 }, { channelGroup: 'meta_paid', count: 1 }]);

  const wider = await getLiveReport(query(30), NOW);
  assert.equal(wider.data.activeVisits, 3);
  assert.equal(wider.data.eventsInWindow, 5);
});

test('events per minute cover every minute of the window, zero-filled and in order', async () => {
  await seedLive();
  const { eventsPerMinute } = (await getLiveReport(query(15), NOW)).data;
  assert.equal(eventsPerMinute.length, 16);
  assert.equal(eventsPerMinute[0].minute, '2026-11-18T11:45:00.000Z');
  assert.equal(eventsPerMinute[15].minute, '2026-11-18T12:00:00.000Z');
  const byMinute = Object.fromEntries(eventsPerMinute.map((entry) => [entry.minute, entry.count]));
  assert.equal(byMinute['2026-11-18T11:59:00.000Z'], 2);
  assert.equal(byMinute['2026-11-18T11:58:00.000Z'], 1);
  assert.equal(byMinute['2026-11-18T11:50:00.000Z'], 1);
  assert.equal(eventsPerMinute.reduce((sum, entry) => sum + entry.count, 0), 4);
});

test('recent events are newest first, anonymized and capped', async () => {
  await seedLive();
  const { recentEvents } = (await getLiveReport(query(15), NOW)).data;
  assert.deepEqual(recentEvents.map((event) => event.name), ['page_view', 'cta_click', 'page_view', 'form_view']);
  assert.equal(recentEvents[0].channelGroup, 'instagram_organic');
  assert.equal(recentEvents[0].path, '/lp/curso');
  assert.equal(recentEvents[0].visit.length, 8);
});

test('the live report never exposes visitor ids or full visit ids', async () => {
  await seedLive();
  const serialized = JSON.stringify(await getLiveReport(query(60), NOW));
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(serialized));
});

test('an idle site reports zeros', async () => {
  const { data } = await getLiveReport(query(5), NOW);
  assert.deepEqual([data.activeVisits, data.eventsInWindow, data.recentEvents.length], [0, 0, 0]);
  assert.equal(data.eventsPerMinute.length, 6);
});
