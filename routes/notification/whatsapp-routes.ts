import express, { Router } from 'express';
import { verifyWebhook, handleWebhook } from '../../controllers/notification/whatsapp-controller.js';

const router: Router = express.Router();

/**
 * @route   GET /api/notifications/whatsapp/webhook
 * @desc    Meta Webhook Verification (Subscribe)
 */
router.get('/webhook', verifyWebhook);

/**
 * @route   POST /api/notifications/whatsapp/webhook
 * @desc    Meta Webhook Handling (Messages & Status)
 */
router.post('/webhook', handleWebhook);

export default router;
