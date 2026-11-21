import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import type { Request, Response } from 'express';
import { handleWebhook } from './whatsapp-controller.js';

const previousSecret = process.env.META_APP_SECRET;
before(() => { process.env.META_APP_SECRET = 'whatsapp-test-secret'; });
after(() => {
  if (previousSecret === undefined) delete process.env.META_APP_SECRET;
  else process.env.META_APP_SECRET = previousSecret;
});

const makeRequest = (rawBody: Buffer, signature: string): Request => ({
  body: JSON.parse(rawBody.toString()),
  rawBody,
  headers: { 'x-hub-signature-256': signature },
} as unknown as Request);

const makeResponse = () => {
  let status = 200;
  let payload = '';
  const response = {
    status(code: number) { status = code; return response; },
    send(value: string) { payload = value; return response; },
    sendStatus(code: number) { status = code; return response; },
  } as unknown as Response;
  return { response, result: () => ({ status, payload }) };
};

test('WhatsApp webhook accepts a valid signature on the raw body', async () => {
  const rawBody = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');
  const hash = crypto.createHmac('sha256', 'whatsapp-test-secret').update(rawBody).digest('hex');
  const { response, result } = makeResponse();

  await handleWebhook(makeRequest(rawBody, `sha256=${hash}`), response);

  assert.deepEqual(result(), { status: 200, payload: 'EVENT_RECEIVED' });
});

test('WhatsApp webhook rejects a signature from another app', async () => {
  const rawBody = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');
  const hash = crypto.createHmac('sha256', 'other-secret').update(rawBody).digest('hex');
  const { response, result } = makeResponse();

  await handleWebhook(makeRequest(rawBody, `sha256=${hash}`), response);

  assert.equal(result().status, 401);
});
