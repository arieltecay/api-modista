import express, { Router } from 'express';
import { 
  verifyWebhook, 
  handleWebhook 
} from '../../controllers/notification/instagram-controller.js';

const router: Router = express.Router();

/**
 * @route   GET /api/notification/instagram/webhook
 * @desc    Meta Webhook Verification (Subscribe)
 * @access  Público (Meta lo llama)
 */
router.get('/webhook', verifyWebhook);

/**
 * @route   POST /api/notification/instagram/webhook
 * @desc    Meta Webhook Handling (Incoming Messages)
 * @access  Público (Meta lo llama)
 */
router.post('/webhook', handleWebhook);

export default router;
