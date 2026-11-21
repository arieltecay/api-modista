import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';
import { processBotWebhookMessage } from './index.js';

let stopDb: () => Promise<void>;
before(async () => { stopDb = await startTestDb(); });
after(async () => stopDb());

test('a repeated Meta message is handled once after success', async () => {
  let calls = 0;
  await processBotWebhookMessage('instagram', 'message-1', async () => { calls += 1; });
  await processBotWebhookMessage('instagram', 'message-1', async () => { calls += 1; });
  assert.equal(calls, 1);
});

test('a failed send is retried on the next delivery', async () => {
  let calls = 0;
  await assert.rejects(processBotWebhookMessage('instagram', 'message-2', async () => { calls += 1; throw new Error('Graph failed'); }));
  await processBotWebhookMessage('instagram', 'message-2', async () => { calls += 1; });
  assert.equal(calls, 2);
});

test('a message that keeps failing stops being retried after three attempts', async () => {
  let calls = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(processBotWebhookMessage('instagram', 'message-3', async () => { calls += 1; throw new Error('Graph rejected'); }));
  }
  await processBotWebhookMessage('instagram', 'message-3', async () => { calls += 1; });
  assert.equal(calls, 3);
});
