import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { afterEach } from 'node:test';
import type { Request, Response } from 'express';
import { verifyWebhookSignature } from './webhookSignature.js';

const SECRET = 'test-secret';
const originalEnv = { secret: process.env.MP_WEBHOOK_SECRET, nodeEnv: process.env.NODE_ENV };

afterEach(() => {
  restoreEnv('MP_WEBHOOK_SECRET', originalEnv.secret);
  restoreEnv('NODE_ENV', originalEnv.nodeEnv);
});

const restoreEnv = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

const sign = (dataId: string, requestId: string, ts: string) =>
  crypto.createHmac('sha256', SECRET).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');

interface Outcome {
  nextCalled: boolean;
  status?: number;
}

const run = (headers: Record<string, string>, query: Record<string, string>): Outcome => {
  const outcome: Outcome = { nextCalled: false };
  const req = {
    header: (name: string) => headers[name.toLowerCase()],
    query,
    headers,
    socket: {},
    originalUrl: '/api/payment/webhook',
    method: 'POST',
  } as unknown as Request;
  const res = {
    status: (code: number) => {
      outcome.status = code;
      return { json: () => undefined };
    },
  } as unknown as Response;
  verifyWebhookSignature(req, res, () => {
    outcome.nextCalled = true;
  });
  return outcome;
};

test('accepts a correctly signed notification', () => {
  process.env.MP_WEBHOOK_SECRET = SECRET;
  const outcome = run(
    { 'x-signature': `ts=1,v1=${sign('99', 'req-1', '1')}`, 'x-request-id': 'req-1' },
    { 'data.id': '99' }
  );
  assert.equal(outcome.nextCalled, true);
});

test('rejects a wrong signature', () => {
  process.env.MP_WEBHOOK_SECRET = SECRET;
  const outcome = run({ 'x-signature': 'ts=1,v1=deadbeef', 'x-request-id': 'req-1' }, { 'data.id': '99' });
  assert.equal(outcome.nextCalled, false);
  assert.equal(outcome.status, 401);
});

test('rejects a signature of a different length without throwing', () => {
  process.env.MP_WEBHOOK_SECRET = SECRET;
  const outcome = run({ 'x-signature': 'ts=1,v1=ab', 'x-request-id': 'req-1' }, { 'data.id': '99' });
  assert.equal(outcome.status, 401);
});

test('in production a missing secret fails closed with a retryable 503', () => {
  delete process.env.MP_WEBHOOK_SECRET;
  process.env.NODE_ENV = 'production';
  const outcome = run({}, { 'data.id': '99' });
  assert.equal(outcome.nextCalled, false);
  assert.equal(outcome.status, 503);
});

test('outside production a missing secret skips verification', () => {
  delete process.env.MP_WEBHOOK_SECRET;
  process.env.NODE_ENV = 'development';
  const outcome = run({}, { 'data.id': '99' });
  assert.equal(outcome.nextCalled, true);
});
