import express, { Router } from 'express';
import { verifyWebhook, handleWebhook } from '../../controllers/notification/whatsapp-controller.js';
import { 
  getTemplates, 
  createTemplate, 
  deleteTemplate, 
  sendTestTemplate 
} from '../../controllers/notification/whatsapp-template-controller.js';
import { authenticateToken, requireAdmin } from '../../middleware/authMiddleware.js';

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

/**
 * @route   GET /api/notifications/whatsapp/templates
 * @desc    Get all message templates from Meta
 */
router.get('/templates', authenticateToken, requireAdmin, getTemplates);

/**
 * @route   POST /api/notifications/whatsapp/templates
 * @desc    Create a new message template in Meta
 */
router.post('/templates', authenticateToken, requireAdmin, createTemplate);

/**
 * @route   DELETE /api/notifications/whatsapp/templates/:name
 * @desc    Delete a message template from Meta
 */
router.delete('/templates/:name', authenticateToken, requireAdmin, deleteTemplate);

/**
 * @route   POST /api/notifications/whatsapp/templates/test
 * @desc    Send a test template to a specific number
 */
router.post('/templates/test', authenticateToken, requireAdmin, sendTestTemplate);

export default router;
