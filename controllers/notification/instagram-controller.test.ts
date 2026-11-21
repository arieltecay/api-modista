import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Request, Response } from 'express';
import { handleWebhook } from './instagram-controller.js';
import ConversationMessage from '../../models/ConversationMessage.js';
import { startTestDb } from '../../utils/testing/mongoMemoryServer.js';

const previousSecret = process.env.META_INSTAGRAM_APP_SECRET;
let stopDb: () => Promise<void>;
before(async () => {
  process.env.META_INSTAGRAM_APP_SECRET = 'instagram-test-secret';
  stopDb = await startTestDb();
  await ConversationMessage.init();
});
after(async () => {
  if (previousSecret === undefined) delete process.env.META_INSTAGRAM_APP_SECRET;
  else process.env.META_INSTAGRAM_APP_SECRET = previousSecret;
  await stopDb();
});

const requestFor = (body: Buffer, signature: string): Request => ({
  body: JSON.parse(body.toString()),
  rawBody: body,
  headers: { 'x-hub-signature-256': signature },
  get: () => undefined,
} as unknown as Request);

const responseFor = () => {
  let status = 200;
  let payload = '';
  const response = {
    status(code: number) { status = code; return response; },
    send(value: string) { payload = value; return response; },
    sendStatus(code: number) { status = code; return response; },
  } as unknown as Response;
  return { response, result: () => ({ status, payload }) };
};

test('Instagram webhook accepts a signature for the exact raw body', async () => {
  const rawBody = Buffer.from('{"object":"instagram","entry":[]}');
  const hash = crypto.createHmac('sha256', 'instagram-test-secret').update(rawBody).digest('hex');
  const { response, result } = responseFor();

  await handleWebhook(requestFor(rawBody, `sha256=${hash}`), response);

  assert.deepEqual(result(), { status: 200, payload: 'EVENT_RECEIVED' });
});

test('Instagram webhook rejects a signature from another app secret', async () => {
  const rawBody = Buffer.from('{"object":"instagram","entry":[]}');
  const hash = crypto.createHmac('sha256', 'other-app-secret').update(rawBody).digest('hex');
  const { response, result } = responseFor();

  await handleWebhook(requestFor(rawBody, `sha256=${hash}`), response);

  assert.equal(result().status, 401);
});

test('Instagram stores unmatched messages without answering automatically', async () => {
  const rawBody = Buffer.from(JSON.stringify({ object: 'instagram', entry: [{ id: 'ig-business', time: 1, messaging: [{ sender: { id: 'ig-customer' }, recipient: { id: 'ig-business' }, timestamp: 1, message: { mid: 'm-1', text: 'Hola' } }] }] }));
  const hash = crypto.createHmac('sha256', 'instagram-test-secret').update(rawBody).digest('hex');
  const { response, result } = responseFor();

  await handleWebhook(requestFor(rawBody, `sha256=${hash}`), response);

  assert.equal(result().status, 200);
  const messages = await ConversationMessage.find({ platform: 'instagram', platform_id: 'ig-customer' }).lean();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].direction, 'inbound');
});

test('Instagram retry of the same message id keeps a single inbound entry', async () => {
  const rawBody = Buffer.from(JSON.stringify({ object: 'instagram', entry: [{ id: 'ig-business', time: 1, messaging: [{ sender: { id: 'ig-retry' }, recipient: { id: 'ig-business' }, timestamp: 1, message: { mid: 'm-retry', text: 'Hola' } }] }] }));
  const hash = crypto.createHmac('sha256', 'instagram-test-secret').update(rawBody).digest('hex');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { response, result } = responseFor();
    await handleWebhook(requestFor(rawBody, `sha256=${hash}`), response);
    assert.equal(result().status, 200);
  }

  assert.equal(await ConversationMessage.countDocuments({ platform: 'instagram', platform_id: 'ig-retry' }), 1);
});
