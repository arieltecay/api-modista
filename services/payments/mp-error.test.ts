import assert from 'node:assert/strict';
import test from 'node:test';
import { describeMercadoPagoError } from './mp-error.js';

test('extracts safe diagnostics from a plain Mercado Pago API error', () => {
  assert.deepEqual(describeMercadoPagoError({ message: 'Payment not found', error: 'not_found', status: 404 }), {
    errorMessage: 'Payment not found',
    providerCode: 'not_found',
    providerStatus: 404,
  });
});

test('does not log arbitrary provider objects or sensitive fields', () => {
  assert.deepEqual(describeMercadoPagoError({ message: { email: 'person@example.com' }, access_token: 'secret' }), {
    errorMessage: 'Error no identificado de Mercado Pago',
  });
});

test('handles native and primitive errors', () => {
  assert.deepEqual(describeMercadoPagoError(new Error('network timeout')), { errorMessage: 'network timeout' });
  assert.deepEqual(describeMercadoPagoError('network timeout'), { errorMessage: 'network timeout' });
});

test('redacts contact details and limits provider text', () => {
  const details = describeMercadoPagoError({ message: `payer person@example.com ${'x'.repeat(500)}`, error: 'invalid_token' });
  assert.equal(details.errorMessage.includes('person@example.com'), false);
  assert.equal(details.errorMessage.length <= 300, true);
});
