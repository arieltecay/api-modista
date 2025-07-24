import express from 'express';
import { sendPurchaseNotification } from '../../controllers/notification/notificationSuccess.js';

const router = express.Router();

// POST /api/payment/success
router.get('/success', sendPurchaseNotification);

export default router;