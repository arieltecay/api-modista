/**
 * TEST E2E local del procesador de pagos (webhook path).
 * Simula el payload que MP enviaría tras un pago aprobado, contra la DB de test.
 * Corre con: META_TEST_EVENT_CODE=TEST99887 EMAIL_MODE=file node scripts/test-e2e-payment.mjs
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../dist/config/db.js';
import { processWebhookPayment } from '../dist/services/payments/webhookProcessor.js';
import Inscription from '../dist/models/Inscription.js';

const INSCRIPTION_ID = process.argv[2];
if (!INSCRIPTION_ID) {
  console.error('Uso: node test-e2e-payment.mjs <inscriptionId>');
  process.exit(1);
}

// paymentId único por corrida: reutilizar uno ya procesado dispararía
// correctamente la idempotencia (y el test parecería fallar).
const PAYMENT_ID_APPROVED = Number(`999${Date.now().toString().slice(-9)}`);
const PAYMENT_ID_REJECTED = PAYMENT_ID_APPROVED + 1;

await connectDB();

console.log('\n=== 1) Pago APROBADO (debería pasar a paid + Purchase CAPI + email) ===');
await processWebhookPayment({
  id: PAYMENT_ID_APPROVED,
  status: 'approved',
  transaction_amount: 20000,
  payment_method_id: 'visa',
  date_approved: new Date().toISOString(),
  external_reference: INSCRIPTION_ID,
});

let doc = await Inscription.findById(INSCRIPTION_ID).lean();
console.log('paymentStatus:', doc.paymentStatus);
console.log('depositAmount:', doc.depositAmount);
console.log('paymentHistory.length:', doc.paymentHistory.length);
console.log('metaPurchaseFiredAt:', doc.metaPurchaseFiredAt);

console.log('\n=== 2) Mismo webhook OTRA VEZ (idempotencia: no debe duplicar) ===');
await processWebhookPayment({
  id: PAYMENT_ID_APPROVED,
  status: 'approved',
  transaction_amount: 20000,
  payment_method_id: 'visa',
  date_approved: new Date().toISOString(),
  external_reference: INSCRIPTION_ID,
});
doc = await Inscription.findById(INSCRIPTION_ID).lean();
console.log('paymentHistory.length (debe seguir 1):', doc.paymentHistory.length);
console.log('depositAmount (debe seguir 20000):', doc.depositAmount);

console.log('\n=== 3) Pago RECHAZADO (NO debe sumar al total) ===');
await processWebhookPayment({
  id: PAYMENT_ID_REJECTED,
  status: 'rejected',
  status_detail: 'cc_rejected_insufficient_amount',
  transaction_amount: 20000,
  payment_method_id: 'visa',
  external_reference: INSCRIPTION_ID,
});
doc = await Inscription.findById(INSCRIPTION_ID).lean();
console.log('paymentHistory.length (debe seguir 1):', doc.paymentHistory.length);
console.log('depositAmount (debe seguir 20000):', doc.depositAmount);
console.log('paymentStatus (debe seguir paid):', doc.paymentStatus);

console.log('\n✅ E2E webhook test finalizado');
await mongoose.disconnect();
process.exit(0);
