import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmationPaymentLink } from './confirmationPaymentLink.js';

test('paid inscription without Mercado Pago link gets an internal retry link in its email', () => {
  assert.equal(
    confirmationPaymentLink({ coursePrice: 20900, inscriptionId: 'inscription-123', frontendUrl: 'https://modista-app.com' }),
    'https://modista-app.com/payment/failure?inscription_id=inscription-123&reason=checkout_unavailable',
  );
});

test('an available Mercado Pago link remains the email destination', () => {
  assert.equal(
    confirmationPaymentLink({ coursePrice: 20900, inscriptionId: 'inscription-123', frontendUrl: 'https://modista-app.com', isDevelopment: false, mpInitPoint: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=1', sandboxInitPoint: 'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=1' }),
    'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=1&utm_source=email&utm_medium=email&utm_campaign=payment_reminder',
  );
});
