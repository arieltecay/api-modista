import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';
import { logger } from '../../services/logger.js';
import { createWebhookHandler } from './webhookController.js';

const request = {
  query: { 'data.id': '191200141832', type: 'payment' },
} as unknown as Request;

const response = () => {
  let status = 200;
  let body: unknown;
  const res = {
    status(code: number) { status = code; return this; },
    json(value: unknown) { body = value; return this; },
    headersSent: false,
  } as unknown as Response;
  return { res, result: () => ({ status, body }) };
};

test('a provider lookup failure remains retryable and logs provider diagnostics', async () => {
  const logged: Array<Record<string, unknown>> = [];
  const originalError = logger.error;
  logger.error = ((message: string, metadata: Record<string, unknown>) => {
    logged.push({ message, ...metadata });
    return logger;
  }) as typeof logger.error;

  try {
    const { res, result } = response();
    await createWebhookHandler({
      isConfigured: () => true,
      getPayment: async () => { throw { message: 'Payment not found', error: 'not_found', status: 404 }; },
      processPayment: async () => { throw new Error('should not process'); },
    })(request, res);

    assert.deepEqual(result(), { status: 500, body: { received: false } });
    assert.equal(logged[0].stage, 'payment_lookup');
    assert.equal(logged[0].providerCode, 'not_found');
    assert.equal(logged[0].providerStatus, 404);
  } finally {
    logger.error = originalError;
  }
});

test('a local processing failure is not labeled as a provider failure', async () => {
  const logged: Array<Record<string, unknown>> = [];
  const originalError = logger.error;
  logger.error = ((message: string, metadata: Record<string, unknown>) => {
    logged.push({ message, ...metadata });
    return logger;
  }) as typeof logger.error;

  try {
    const { res, result } = response();
    await createWebhookHandler({
      isConfigured: () => true,
      getPayment: async () => ({ id: 191200141832, status: 'approved' }),
      processPayment: async () => { throw new Error('database unavailable'); },
    })(request, res);

    assert.deepEqual(result(), { status: 500, body: { received: false } });
    assert.equal(logged[0].stage, 'payment_processing');
    assert.equal(logged[0].providerCode, undefined);
  } finally {
    logger.error = originalError;
  }
});

test('a processed notification responds 200', async () => {
  const logged: Array<Record<string, unknown>> = [];
  const originalInfo = logger.info;
  logger.info = ((message: string, metadata: Record<string, unknown>) => {
    logged.push({ message, ...metadata });
    return logger;
  }) as typeof logger.info;

  try {
    const { res, result } = response();
    await createWebhookHandler({
      isConfigured: () => true,
      getPayment: async () => ({ id: 191200141832, status: 'approved' }),
      processPayment: async () => undefined,
    })(request, res);
    assert.deepEqual(result(), { status: 200, body: { received: true } });
    assert.deepEqual(logged[0], {
      message: '[Webhook] Notificación atendida',
      paymentId: '191200141832',
      paymentStatus: 'approved',
    });
  } finally {
    logger.info = originalInfo;
  }
});
