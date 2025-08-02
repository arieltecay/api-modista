import express from 'express';
import { paymentSuccess, getVerifiedPaymentData } from '../../controllers/payment/paymentSuccess.js';
import { createPreference } from '../../controllers/payment/paymentController.js';

const router = express.Router();

// Ruta a la que Mercado Pago redirige tras un pago exitoso
router.get('/success', paymentSuccess);

// Ruta segura para que el frontend obtenga los datos del pago verificado
router.get('/data', getVerifiedPaymentData);

// Ruta para crear la preferencia de pago
router.post('/create-preference', createPreference);

export default router;