import express from 'express';
import { paymentSuccess } from '../../controllers/payment/paymentSuccess.js';
import { createPreference } from '../../controllers/payment/paymentController.js';

const router = express.Router();

// POST /api/payment/success
router.get('/success', paymentSuccess);

// POST /api/payment/create-preference
router.post('/create-preference', createPreference);

export default router;