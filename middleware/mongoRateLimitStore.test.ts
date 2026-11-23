import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import RateLimitHit from '../models/RateLimitHit/index.js';
import { startTestDb } from '../utils/testing/mongoMemoryServer.js';
import { MongoRateLimitStore } from './mongoRateLimitStore.js';

let stopDb: () => Promise<void>;
before(async () => {
  stopDb = await startTestDb();
  await RateLimitHit.init();
});
after(async () => stopDb());
beforeEach(async () => RateLimitHit.deleteMany({}));

const WINDOW_MS = 15 * 60 * 1000;
const store = (prefix = 'test', clock: { now: number } = { now: Date.parse('2026-11-23T12:00:00Z') }) => {
  const instance = new MongoRateLimitStore({ prefix, now: () => clock.now });
  instance.init({ windowMs: WINDOW_MS } as never);
  return { instance, clock };
};

test('counts the hits of a key inside one window and reports when the window ends', async () => {
  const { instance, clock } = store();

  const first = await instance.increment('1.2.3.4');
  const second = await instance.increment('1.2.3.4');

  assert.equal(first.totalHits, 1);
  assert.equal(second.totalHits, 2);
  assert.equal(second.resetTime?.getTime(), clock.now + WINDOW_MS);
});

test('a key starts again from one once its window is over', async () => {
  const { instance, clock } = store();
  await instance.increment('1.2.3.4');
  await instance.increment('1.2.3.4');

  clock.now += WINDOW_MS + 1;
  const after = await instance.increment('1.2.3.4');

  assert.equal(after.totalHits, 1);
  assert.equal(after.resetTime?.getTime(), clock.now + WINDOW_MS);
});

test('keys do not share counts, and neither do stores with different prefixes', async () => {
  const { instance: coupons } = store('coupons');
  const { instance: inscriptions } = store('inscriptions');

  await coupons.increment('1.2.3.4');
  await coupons.increment('1.2.3.4');

  assert.equal((await coupons.increment('5.6.7.8')).totalHits, 1);
  assert.equal((await inscriptions.increment('1.2.3.4')).totalHits, 1);
});

test('simultaneous hits, as from several serverless instances, are all counted exactly once', async () => {
  const { instance } = store();

  const results = await Promise.all(Array.from({ length: 25 }, () => instance.increment('1.2.3.4')));

  assert.deepEqual(results.map((result) => result.totalHits).sort((a, b) => a - b), Array.from({ length: 25 }, (_, index) => index + 1));
});

test('decrement gives back one hit (a successful request does not use up an attempt) and never goes below zero', async () => {
  const { instance } = store();
  await instance.increment('1.2.3.4');
  await instance.increment('1.2.3.4');

  await instance.decrement('1.2.3.4');
  assert.equal((await instance.increment('1.2.3.4')).totalHits, 2);

  await instance.decrement('unknown');
  await instance.resetKey('1.2.3.4');
  await instance.decrement('1.2.3.4');
  assert.equal((await instance.increment('1.2.3.4')).totalHits, 1);
});

test('resetKey forgets a key and resetAll forgets only this store', async () => {
  const { instance: mine } = store('mine');
  const { instance: other } = store('other');
  await mine.increment('a');
  await other.increment('a');

  await mine.resetAll();

  assert.equal((await mine.increment('a')).totalHits, 1);
  assert.equal((await other.increment('a')).totalHits, 2);
});

test('the stored rows expire on their own (TTL index on the end of the window)', async () => {
  await RateLimitHit.init();
  const indexes = await RateLimitHit.collection.indexes();

  const ttl = indexes.find((index) => index.key && 'resetAt' in index.key);
  assert.equal(ttl?.expireAfterSeconds, 0);
});

test('if MongoDB fails the limiter keeps counting in memory instead of letting everything through', async () => {
  const { instance } = store('fallback');
  const originalIncrement = RateLimitHit.findOneAndUpdate.bind(RateLimitHit);
  const originalDecrement = RateLimitHit.updateOne.bind(RateLimitHit);
  const down = async () => {
    throw new Error('mongo down');
  };
  (RateLimitHit as { findOneAndUpdate: unknown }).findOneAndUpdate = down;
  (RateLimitHit as { updateOne: unknown }).updateOne = down;

  try {
    const hits = [await instance.increment('1.2.3.4'), await instance.increment('1.2.3.4'), await instance.increment('1.2.3.4')];
    assert.deepEqual(hits.map((hit) => hit.totalHits), [1, 2, 3]);
    await instance.decrement('1.2.3.4');
    assert.equal((await instance.increment('1.2.3.4')).totalHits, 3);
  } finally {
    (RateLimitHit as { findOneAndUpdate: unknown }).findOneAndUpdate = originalIncrement;
    (RateLimitHit as { updateOne: unknown }).updateOne = originalDecrement;
  }
});
