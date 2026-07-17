import express, { Router } from 'express';
import { createPreference } from '../../controllers/payment/paymentController.js';
import { handleWebhook } from '../../controllers/payment/webhookController.js';
import { getPaymentStatus } from '../../controllers/payment/paymentStatus.js';
import { verifyWebhookSignature } from '../../middleware/webhookSignature.js';

const router: Router = express.Router();

/**
 * Webhook de MercadoPago.
 * - El webhook handler SOLO lee query params (topic, type, data.id),
 *   no el body. Por eso no necesitamos express.raw() ni middleware de
 *   re-parseo — el express.json() global es suficiente.
 * - Se aplica verifyWebhookSignature antes del handler.
 */
router.post(
  '/webhook',
  verifyWebhookSignature,
  handleWebhook
);

// Endpoint público de polling para el front tras el redirect
router.get('/status/:inscriptionId', getPaymentStatus);

// Crear preference para una inscripción existente
router.post('/create-preference', createPreference);

export default router;
