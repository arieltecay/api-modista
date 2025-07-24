import express from 'express';
import { paymentSuccess } from '../../controllers/payment/paymentSuccess.js';

const router = express.Router();

// POST /api/payment/success
router.get('/success', paymentSuccess);

export default router;